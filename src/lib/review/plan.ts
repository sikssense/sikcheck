import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getDb, newId } from "../db";
import { getProject, getRound, projectKnowledge } from "../repo";
import { fetchPlanSnapshot, downloadScreenImages, type PlanScreen, type PlanSnapshot } from "../figma";
import { AiError, askStructured, budgetUsd, currentModel } from "../ai";

export const PLAN_CATEGORIES = ["불일치", "누락", "충돌", "용어", "오탈자", "확인 필요", "제안"] as const;

const FindingSchema = z.object({
  findings: z.array(
    z.object({
      category: z.enum(PLAN_CATEGORIES),
      severity: z.enum(["높음", "보통", "낮음"]),
      title: z.string().describe("한 줄 요약"),
      expected: z.string().describe("기획상 기대되는 것 또는 근거가 되는 쪽"),
      actual: z.string().describe("실제로 적혀 있거나 그려진 것"),
      evidence: z.string().describe("입력 텍스트에서 그대로 인용한 근거. 여러 개면 ' / '로 구분"),
      confidence: z.number().describe("0~1. 근거가 직접 인용으로 확인되면 높게, 추정이면 낮게"),
    })
  ),
  questions: z.array(z.string().describe("기획자에게 물어봐야 판단할 수 있는 것")),
});
type FindingOut = z.infer<typeof FindingSchema>["findings"][number];

const COMMON_RULES = `규칙:
- 반드시 주어진 텍스트에서 근거를 그대로 인용합니다. 근거를 인용할 수 없으면 보고하지 않습니다.
- 추측으로 문제를 만들지 않습니다. 확신이 0.6 미만이면 보고하지 않고, 정말 판단에 필요한 것만 questions에 남깁니다.
- 주석(anno/로 시작하는 레이어)과 디스크립션 번호는 기획자의 설명이므로 화면 요소로 보지 않습니다.
- 샘플 데이터는 문제로 보지 않습니다. 이름·번호·날짜·금액·건수 같은 예시 값, 0건/빈 상태 화면의 0 값, 페이지 수와 건수의 산술 관계 등은 실제 데이터가 아니에요. 단 단위나 표기 형식(예: ft와 m)이 다르면 보고합니다.
- 중요한 것부터 고릅니다. 실제로 개발·QA에서 혼선을 만들 문제를 우선하고, 취향 수준의 제안은 빼요.
- 같은 문제를 여러 번 쓰지 않습니다. 문제가 없으면 빈 배열을 반환합니다.
- 모든 문장은 한국어 해요체로 짧게 씁니다.`;

const SYSTEM = `당신은 한국어 서비스 기획서를 검수하는 시니어 기획자입니다.
Figma 기획서에서 추출한 한 화면의 텍스트와, 그 화면을 설명하는 디스크립션(desc) 텍스트가 주어집니다. 화면 이미지가 함께 주어지면 배치·상태 표현도 함께 봅니다.

찾을 것 (이 화면 안에서):
- 불일치: 화면과 디스크립션이 서로 다르다 (필드 개수·이름·순서, 버튼 문구, 선택지, 단위, 상태 문구)
- 누락: 이 화면의 요소·동작인데 디스크립션에 설명이 없다, 또는 디스크립션에 있는데 화면에 없다
- 충돌: 디스크립션 안에서 정책·숫자·규칙이 서로 맞지 않는다
- 오탈자: 맞춤법·띄어쓰기·오타
- 확인 필요: 기획서에 "[확인 필요]", "미정", "TBD" 등으로 열려 있는 항목
- 제안: 오류는 아니지만 개발 전에 정해두지 않으면 혼선이 생길 것 (예외 처리 등)

용어 통일(같은 대상을 다른 말로 부르는 것)은 섹션 전체를 따로 검사하니 여기서는 보고하지 않습니다.
findings는 최대 5개, questions는 최대 2개까지만 씁니다.

${COMMON_RULES}`;

const TERMS_SYSTEM = `당신은 한국어 서비스 기획서를 검수하는 시니어 기획자입니다.
한 섹션에 속한 여러 화면과 디스크립션의 텍스트가 주어집니다. 섹션 전체에서 같은 대상을 서로 다른 말로 부르는 용어 불일치와, 화면 사이에 정책·문구가 서로 맞지 않는 충돌만 찾습니다.

- 같은 문제는 한 건으로 묶고, screens에 해당 화면 키를 모두 적습니다.
- 띄어쓰기만 다른 표기(예: 자산신청/자산 신청)도 용어 불일치로 묶어 한 건으로 씁니다.
- 화면이 하나뿐인 문제는 쓰지 않습니다 (화면별 검사에서 다뤄요).
- findings는 최대 8개까지만 씁니다.

${COMMON_RULES}`;

const TermsSchema = z.object({
  findings: z.array(
    z.object({
      category: z.enum(["용어", "충돌"]),
      severity: z.enum(["높음", "보통", "낮음"]),
      title: z.string(),
      expected: z.string().describe("통일해야 할 표현 또는 맞춰야 할 기준"),
      actual: z.string().describe("화면별로 어떻게 다르게 쓰였는지"),
      evidence: z.string().describe("그대로 인용한 근거. ' / '로 구분"),
      confidence: z.number(),
      screens: z.array(z.string()).describe("해당 화면 키 목록"),
    })
  ),
});

function textBlock(label: string, texts: { text: string; layer: string }[]): string {
  const lines = texts.map((t, i) => `${i + 1}. [${t.layer}] ${t.text.replace(/\s*\n\s*/g, " ⏎ ")}`);
  return `## ${label}\n${lines.join("\n") || "(없음)"}`;
}

function setRun(runId: string, fields: Record<string, string | number | null>) {
  const keys = Object.keys(fields);
  getDb()
    .prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), runId);
}

function addFinding(roundId: string, runId: string, screen: string, f: Omit<FindingOut, "confidence"> & { confidence: number | null }, source: "ai" | "rule") {
  getDb()
    .prepare(
      `INSERT INTO findings (id, round_id, run_id, screen_id, type, severity, title, expected, actual, evidence, judge, confidence, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?, ?)`
    )
    .run(newId(), roundId, runId, screen, f.category, f.severity, f.title, f.expected, f.actual, f.evidence, f.confidence, source);
}

function addQuestion(projectId: string, roundId: string, runId: string, screen: string, q: string) {
  getDb()
    .prepare("INSERT INTO questions (id, project_id, round_id, run_id, screen_id, question) VALUES (?, ?, ?, ?, ?, ?)")
    .run(newId(), projectId, roundId, runId, screen, q);
}

// AI 없이 구조만으로 잡는 것 (무료)
function ruleChecks(snap: PlanSnapshot): { screen: string; f: Omit<FindingOut, "confidence"> }[] {
  const out: { screen: string; f: Omit<FindingOut, "confidence"> }[] = [];
  const keys = new Set(snap.screens.map((s) => s.key));
  for (const s of snap.screens) {
    if (!s.desc && !s.state) {
      out.push({ screen: s.key, f: { category: "누락", severity: "보통", title: "디스크립션이 없는 화면이에요", expected: `desc_${s.key} 프레임`, actual: "없음", evidence: s.title } });
    }
  }
  // 한쪽 플랫폼에만 있는 화면은 기능(base) 단위로 묶어 한 건만. PC 전용일 수 있어 '확인 필요'로.
  const missing = new Map<string, { platform: string; other: string; screens: string[] }>();
  for (const s of snap.screens) {
    const other = s.platform === "PC" ? "MO" : "PC";
    const pair = `${s.base}${s.state ? ` (${s.state})` : ""}_${other}`;
    if (keys.has(pair)) continue;
    const k = `${s.base}|${s.platform}`;
    const m = missing.get(k) ?? { platform: s.platform, other, screens: [] };
    m.screens.push(s.key);
    missing.set(k, m);
  }
  for (const [k, m] of missing) {
    const base = k.split("|")[0];
    out.push({
      screen: m.screens[0],
      f: {
        category: "확인 필요",
        severity: "낮음",
        title: `${base}: ${m.platform} 화면 ${m.screens.length}개에 ${m.other} 버전이 없어요`,
        expected: `${m.other} 버전 화면, 또는 ${m.platform} 전용이라는 표기`,
        actual: `${m.platform}에만 있음`,
        evidence: m.screens.join(" / "),
      },
    });
  }
  for (const o of snap.orphanDescs) {
    out.push({ screen: o.key, f: { category: "누락", severity: "낮음", title: "화면 없이 디스크립션만 있어요", expected: `${o.key} 화면`, actual: "디스크립션만 있음", evidence: `desc_${o.key}` } });
  }
  return out;
}

// 섹션 전체 텍스트를 한 번에 보내 용어·화면 간 충돌을 묶어서 찾는다 (이미지 없이 텍스트만)
function sectionContent(screens: PlanScreen[], snap: PlanSnapshot, knowledge: Knowledge): Anthropic.Beta.BetaContentBlockParam[] {
  const parts = screens.map((s) =>
    [textBlock(`화면 ${s.key}`, s.texts), s.desc ? textBlock(`디스크립션 ${s.key}`, s.desc.texts) : ""].join("\n")
  );
  const k = knowledgeBlock(knowledge, screens.map((x) => x.key));
  return [{ type: "text", text: `# 섹션 ${snap.sectionName}\n\n${k ? `${k}\n\n` : ""}${parts.join("\n\n")}` }];
}

type Knowledge = { screen: string; q: string; a: string }[];

function knowledgeBlock(k: Knowledge, screens: string[]): string {
  // 이 화면(또는 같은 기능)에 대한 답 + 화면을 특정하지 않은 답
  const rel = k.filter((x) => !x.screen || screens.some((s) => s === x.screen || s.split(" ")[0] === x.screen.split(" ")[0]));
  if (rel.length === 0) return "";
  const lines = rel.map((x) => `- Q: ${x.q}\n  A: ${x.a}`).join("\n");
  return `## 기획자가 이미 답한 내용 (이 기준을 따르고, 같은 걸 다시 묻지 않습니다)\n${lines}`;
}

function screenContent(s: PlanScreen, snap: PlanSnapshot, knowledge: Knowledge): Anthropic.Beta.BetaContentBlockParam[] {
  // 상태 화면에 디스크립션이 없으면 기본 화면 디스크립션을 이어서 본다
  const base = !s.desc && s.state ? snap.screens.find((x) => x.base === s.base && !x.state && x.platform === s.platform) : null;
  const desc = s.desc ?? base?.desc ?? null;
  const siblings = snap.screens
    .filter((x) => x.base === s.base && x.key !== s.key)
    .map((x) => `${x.key}${x.desc ? " (전용 디스크립션 있음)" : ""}`);
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (s.imagePath) {
    try {
      blocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(s.imagePath).toString("base64") } });
    } catch {
      // 이미지가 없으면 텍스트만으로 검수
    }
  }
  blocks.push({
    type: "text",
    text: [
      `# 화면 ${s.key}`,
      `프레임 이름: ${s.title}`,
      `같은 기능의 다른 화면: ${siblings.join(", ") || "없음"}`,
      knowledgeBlock(knowledge, [s.key]),
      "다른 화면의 상태·예외는 그 화면 디스크립션에서 다루므로, 이 화면에 없다는 이유로 누락으로 보지 않습니다.",
      textBlock("화면 텍스트 (읽는 순서)", s.texts),
      desc
        ? textBlock(base ? `디스크립션 (상태 화면 전용이 없어 기본 화면 ${base.key}의 것을 사용)` : "디스크립션", desc.texts)
        : "## 디스크립션\n(없음)",
    ].join("\n\n"),
  });
  return blocks;
}

export async function runPlanReview(runId: string): Promise<void> {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as { id: string; round_id: string; scope: string } | undefined;
  if (!run) return;
  const round = getRound(run.round_id)!;
  const project = getProject(round.project_id)!;
  const model = currentModel();
  const knowledge = projectKnowledge(project.id);
  const budget = budgetUsd();
  let spent = 0;
  setRun(runId, { status: "running", started_at: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }), progress: "기획안 읽는 중", phase: "read", done: 0, total: 0, screens: "[]", model, error: null, cost_usd: 0 });

  try {
    if (project.figma_links.length === 0) throw new AiError("기획안 링크가 없어요. 프로젝트에 Figma 링크를 넣어주세요.");
    const snapDir = path.join(process.cwd(), "data", "snapshots", round.id);
    mkdirSync(snapDir, { recursive: true });

    const snaps: PlanSnapshot[] = [];
    for (const link of project.figma_links) {
      const snap = await fetchPlanSnapshot(link);
      setRun(runId, { progress: `${snap.sectionName} 화면 이미지 받는 중`, phase: "images" });
      await downloadScreenImages(snap, path.join(snapDir, "img"));
      snaps.push(snap);
    }
    writeFileSync(path.join(snapDir, "figma.json"), JSON.stringify(snaps, null, 2));
    // 실행 이름: 섹션 이름 (예: "D. AST · 자산신청"), 범위가 있으면 덧붙임
    const sections = snaps.map((sn) => sn.sectionName.replace(/\s+/g, " ").trim()).join(", ");
    setRun(runId, { title: run.scope && run.scope !== "전체" ? `${sections} (${run.scope})` : sections });

    // 범위가 지정되면 화면 키에 그 단어가 들어간 것만
    const scope = run.scope && run.scope !== "전체" ? run.scope : "";
    const inScope = (s: PlanScreen) => !scope || s.key.includes(scope) || s.title.includes(scope);
    const allTargets = snaps.flatMap((sn) => sn.screens.filter(inScope).map((s) => s.key));
    setRun(runId, { phase: "review", total: allTargets.length, done: 0, screens: JSON.stringify(allTargets) });
    let doneCount = 0;

    for (const snap of snaps) {
      for (const r of ruleChecks(snap)) {
        if (scope && !r.screen.includes(scope)) continue;
        addFinding(round.id, runId, r.screen, { ...r.f, confidence: 1 }, "rule");
      }
      const targets = snap.screens.filter(inScope);
      let i = 0;
      for (const s of targets) {
        i++;
        if (spent >= budget) {
          setRun(runId, { status: "stopped", progress: `비용 상한 $${budget}에 도달해 멈췄어요 (${i - 1}/${targets.length} 화면)`, cost_usd: spent });
          return;
        }
        setRun(runId, { progress: `${snap.sectionName} · ${s.key} 검수 중 (${i}/${targets.length})`, cost_usd: spent });
        try {
          const { data, cost } = await askStructured({ model, system: SYSTEM, content: screenContent(s, snap, knowledge), schema: FindingSchema });
          spent += cost;
          for (const f of data.findings.filter((x) => x.confidence >= 0.6).slice(0, 5)) addFinding(round.id, runId, s.key, f, "ai");
          for (const q of data.questions.slice(0, 2)) addQuestion(project.id, round.id, runId, s.key, q);
        } catch (e) {
          if (e instanceof AiError && /거절|잘렸/.test(e.message)) {
            addQuestion(project.id, round.id, runId, s.key, `이 화면은 자동 검수하지 못했어요: ${e.message}`);
          } else {
            throw e;
          }
        }
        doneCount++;
        setRun(runId, { done: doneCount, cost_usd: spent });
      }
    }
    // 섹션 단위 용어·화면 간 충돌 검사 (섹션마다 1번)
    for (const snap of snaps) {
      const targets = snap.screens.filter(inScope);
      if (targets.length < 2) continue;
      if (spent >= budget) break;
      setRun(runId, { progress: `${snap.sectionName} 용어·화면 간 충돌 검사 중`, phase: "done", cost_usd: spent });
      try {
        const { data, cost } = await askStructured({ model, system: TERMS_SYSTEM, content: sectionContent(targets, snap, knowledge), schema: TermsSchema });
        spent += cost;
        for (const f of data.findings.filter((x) => x.confidence >= 0.6).slice(0, 8)) {
          const { screens, ...rest } = f;
          addFinding(round.id, runId, screens.length > 1 ? `섹션 공통 · ${snap.sectionName.trim()}` : screens[0] ?? snap.sectionName, { ...rest, evidence: `${rest.evidence}
(해당 화면: ${screens.join(", ")})` }, "ai");
        }
      } catch (e) {
        if (!(e instanceof AiError && /거절|잘렸/.test(e.message))) throw e;
      }
    }

    setRun(runId, { status: "done", progress: "완료", phase: "done", cost_usd: spent, finished_at: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setRun(runId, { status: "failed", progress: "실패", error: msg, cost_usd: spent });
  }
}
