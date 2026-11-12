import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { readEnv } from "./env";
import { getSetting, setSetting } from "./settings";

export const MODELS = {
  "claude-opus-5-5": { label: "Opus 5.5 · 가장 정확", input: 4, output: 20, cacheRead: 0.2, fallback: true },
  "claude-sonnet-5-5": { label: "Sonnet 5.5 · 절반 가격", input: 2, output: 10, cacheRead: 0.2, fallback: true },
  "claude-haiku-5-5": { label: "Haiku 5.5 · 아주 쌈", input: 0.1, output: 0.5, cacheRead: 0.01, fallback: false },
} as const;
export type ModelId = keyof typeof MODELS;

export function currentModel(): ModelId {
  const m = getSetting("ai.model");
  return m && m in MODELS ? (m as ModelId) : "claude-opus-5-5";
}

export function budgetUsd(): number {
  const v = Number(getSetting("ai.budget_usd"));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function costOf(model: ModelId, u: Anthropic.Beta.BetaUsage): number {
  const p = MODELS[model];
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25;
  return (input * p.input + (u.cache_read_input_tokens ?? 0) * p.cacheRead + u.output_tokens * p.output) / 1_000_000;
}

// 사용자가 이해할 수 있는 말로 바꾼 오류
export class AiError extends Error {}

export async function askStructured<S extends z.ZodType>(opts: {
  model: ModelId;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: S;
}): Promise<{ data: z.infer<S>; cost: number }> {
  const apiKey = readEnv().ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiError("Anthropic 키가 없어요. 설정을 확인해 주세요.");
  const client = new Anthropic({ apiKey });
  const useFallback = MODELS[opts.model].fallback;
  try {
    const res = await client.beta.messages.parse({
      model: opts.model,
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(opts.schema) },
      // 고정 지시문은 캐시해서 두 번째 호출부터 싸게
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.content }],
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const cost = costOf(opts.model, res.usage);
    // 호출이 됐다면 키는 정상. 상단 알림을 지운다.
    setSetting("check.anthropic", JSON.stringify({ state: "ok", detail: "키 정상 (검수 실행으로 확인)", checked_at: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16) }));
    if (res.stop_reason === "refusal") throw new AiError("AI가 이 화면 검수를 거절했어요. 해당 화면만 건너뛰어요.");
    if (res.stop_reason === "max_tokens") throw new AiError("응답이 너무 길어 잘렸어요. 범위를 나눠 다시 실행해 주세요.");
    if (!res.parsed_output) throw new AiError("AI 응답을 해석하지 못했어요.");
    return { data: res.parsed_output as z.infer<S>, cost };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("Anthropic 키가 올바르지 않아요. 설정에서 확인해 주세요.");
    if (e instanceof Anthropic.RateLimitError) throw new AiError("요청이 많아 잠시 막혔어요. 잠시 후 다시 실행해 주세요.");
    if (e instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(e.message)) {
      throw new AiError("Anthropic 크레딧이 부족해요. 콘솔 Billing에서 충전해 주세요.");
    }
    if (e instanceof Anthropic.APIError) throw new AiError(`AI 호출 오류 ${e.status}: ${e.message.slice(0, 160)}`);
    throw e;
  }
}
