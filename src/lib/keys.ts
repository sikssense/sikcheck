import Anthropic from "@anthropic-ai/sdk";
import { readEnv } from "./env";
import { getSetting, setSetting } from "./settings";
import { listProjects } from "./repo";

export type KeyState = "ok" | "missing" | "invalid" | "error";
export type KeyCheck = { state: KeyState; detail: string; checked_at: string };

export const KEY_STATE_LABEL: Record<KeyState, string> = {
  ok: "정상",
  missing: "없음",
  invalid: "사용 불가",
  error: "확인 실패",
};

const now = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);

export async function checkFigma(): Promise<KeyCheck> {
  const token = readEnv().FIGMA_TOKEN;
  if (!token) return { state: "missing", detail: ".env에 FIGMA_TOKEN이 비어 있어요", checked_at: now() };
  if (!token.startsWith("figd_") || /[^\x21-\x7e]/.test(token)) {
    return { state: "invalid", detail: "형식이 달라요. figd_로 시작하는 값만 넣어주세요", checked_at: now() };
  }
  // 권장 권한(파일 읽기)만 있는 토큰은 /v1/me가 거절되므로, 등록된 기획안 파일을 가볍게 읽어서 확인한다
  const fileKey = firstFigmaFileKey();
  const url = fileKey ? `https://api.figma.com/v1/files/${fileKey}?depth=1` : "https://api.figma.com/v1/me";
  try {
    const res = await fetch(url, { headers: { "X-Figma-Token": token } });
    if (res.status === 401) {
      return { state: "invalid", detail: "만료됐거나 폐기된 토큰이에요. 새로 발급해 주세요", checked_at: now() };
    }
    if (res.status === 403) {
      return fileKey
        ? { state: "invalid", detail: "만료됐거나 이 파일을 볼 권한이 없는 토큰이에요", checked_at: now() }
        : { state: "error", detail: "기획안 링크가 있는 프로젝트를 만들면 그 파일로 확인할 수 있어요", checked_at: now() };
    }
    if (!res.ok) return { state: "error", detail: `Figma 응답 ${res.status}`, checked_at: now() };
    const body = (await res.json()) as { name?: string; handle?: string };
    const detail = fileKey ? `「${body.name ?? fileKey}」 파일 읽기 정상` : `${body.handle ?? ""} 계정으로 연결됨`;
    return { state: "ok", detail, checked_at: now() };
  } catch {
    return { state: "error", detail: "Figma에 연결하지 못했어요 (네트워크)", checked_at: now() };
  }
}

function firstFigmaFileKey(): string | null {
  for (const p of listProjects()) {
    for (const link of p.figma_links) {
      const m = link.match(/figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/);
      if (m) return m[1];
    }
  }
  return null;
}

export async function checkAnthropic(): Promise<KeyCheck> {
  const apiKey = readEnv().ANTHROPIC_API_KEY;
  if (!apiKey) return { state: "missing", detail: ".env에 ANTHROPIC_API_KEY가 비어 있어요", checked_at: now() };
  if (!apiKey.startsWith("sk-ant-") || /[^\x21-\x7e]/.test(apiKey)) {
    return { state: "invalid", detail: "형식이 달라요. sk-ant-로 시작하는 값만 넣어주세요", checked_at: now() };
  }
  try {
    // 모델 조회는 과금되지 않는다
    await new Anthropic({ apiKey }).models.retrieve("claude-opus-5-5");
    return { state: "ok", detail: "키 정상. 잔액은 콘솔 Billing에서 확인해요", checked_at: now() };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { state: "invalid", detail: "키가 올바르지 않아요. 잘리지 않게 통째로 다시 복사해 주세요", checked_at: now() };
    }
    if (e instanceof Anthropic.PermissionDeniedError) {
      return { state: "invalid", detail: "이 키로는 사용 권한이 없어요", checked_at: now() };
    }
    if (e instanceof Anthropic.APIError) {
      return { state: "error", detail: `Anthropic 응답 ${e.status}`, checked_at: now() };
    }
    return { state: "error", detail: "Anthropic에 연결하지 못했어요 (네트워크)", checked_at: now() };
  }
}

export async function checkAllKeys() {
  const [figma, anthropic] = await Promise.all([checkFigma(), checkAnthropic()]);
  setSetting("check.figma", JSON.stringify(figma));
  setSetting("check.anthropic", JSON.stringify(anthropic));
  return { figma, anthropic };
}

export function lastChecks(): { figma: KeyCheck | null; anthropic: KeyCheck | null } {
  const parse = (v: string | null) => (v ? (JSON.parse(v) as KeyCheck) : null);
  return { figma: parse(getSetting("check.figma")), anthropic: parse(getSetting("check.anthropic")) };
}

// Figma API는 토큰 만료일을 알려주지 않아서, 발급할 때 고른 만료일을 직접 기록한다
export function figmaExpiry(): { date: string | null; daysLeft: number | null } {
  const date = getSetting("figma.expires_on");
  if (!date) return { date: null, daysLeft: null };
  const today = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }));
  const daysLeft = Math.round((new Date(date).getTime() - today.getTime()) / 86_400_000);
  return { date, daysLeft };
}

// 상단 알림: 만료 7일 전부터, 또는 마지막 확인에서 문제가 있었을 때
export function keyAlerts(): string[] {
  const alerts: string[] = [];
  const { daysLeft } = figmaExpiry();
  if (daysLeft !== null && daysLeft < 0) alerts.push("Figma 토큰이 만료됐어요. 새로 발급해 주세요.");
  else if (daysLeft !== null && daysLeft <= 7) alerts.push(`Figma 토큰이 ${daysLeft === 0 ? "오늘" : `${daysLeft}일 뒤`} 만료돼요.`);
  const { figma, anthropic } = lastChecks();
  if (figma && figma.state !== "ok" && !(daysLeft !== null && daysLeft < 0)) alerts.push(`Figma 토큰: ${figma.detail}`);
  if (anthropic && anthropic.state !== "ok") alerts.push(`Anthropic 키: ${anthropic.detail}`);
  return alerts;
}
