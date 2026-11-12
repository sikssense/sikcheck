import { getDb } from "./db";
import { currentModel, MODELS } from "./ai";
import type { Mode } from "./repo";

// 지난 실행의 화면당 실제 비용으로 견적을 낸다. 기록이 없으면 처음 측정한 값을 기본으로.
const DEFAULT_PER_SCREEN: Record<Mode, number> = { plan: 0.055, impl: 0.09, change: 0 };

export function estimateRun(projectId: string, mode: Mode, scope: string): { text: string; usd: number | null } {
  if (mode === "change") return { text: "AI를 쓰지 않아 비용 없음", usd: 0 };
  const model = currentModel();
  const opus = MODELS["claude-opus-5-5"];
  const ratio = (MODELS[model].input + MODELS[model].output) / (opus.input + opus.output);

  const past = getDb()
    .prepare(
      `SELECT x.cost_usd, x.total, x.model FROM runs x JOIN rounds r ON r.id = x.round_id
       WHERE r.mode = ? AND x.status = 'done' AND x.total > 0 AND x.cost_usd > 0 ORDER BY x.created_at DESC LIMIT 10`
    )
    .all(mode) as unknown as { cost_usd: number; total: number; model: string }[];
  const samples = past.filter((p) => p.model === model);
  const perScreen = samples.length
    ? samples.reduce((a, p) => a + p.cost_usd / p.total, 0) / samples.length
    : DEFAULT_PER_SCREEN[mode] * ratio;

  // 같은 프로젝트의 지난 전체 실행에서 화면 수를 가져온다
  const last = getDb()
    .prepare(
      `SELECT x.total FROM runs x JOIN rounds r ON r.id = x.round_id
       WHERE r.project_id = ? AND r.mode = ? AND x.scope = '전체' AND x.total > 0 ORDER BY x.created_at DESC LIMIT 1`
    )
    .get(projectId, mode) as { total: number } | undefined;

  if (!last || (scope && scope !== "전체")) {
    return { text: `화면당 약 $${perScreen.toFixed(3)} · 화면 수는 실행 때 확정`, usd: null };
  }
  const usd = perScreen * last.total * 1.1; // 섹션 공통 검사 등 여유분
  return { text: `약 $${usd.toFixed(2)} (화면 ${last.total}개 기준)`, usd };
}
