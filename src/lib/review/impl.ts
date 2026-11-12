import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getDb, newId } from "../db";
import { getProject, getRound, projectKnowledge } from "../repo";
import { fetchPlanSnapshot, downloadScreenImages, type PlanScreen, type PlanSnapshot } from "../figma";
import { crawlSite, capturePages, type SitePage, type SiteSnapshot } from "../site";
import { AiError, askStructured, budgetUsd, currentModel } from "../ai";

// 구현 검수: Figma 화면 ↔ 실제 사이트 화면을 짝지어 비교한다 (사이트는 읽기만)

const MapSchema = z.object({
  mappings: z.array(
    z.object({
      screen: z.string().describe("Figma 화면 키"),
      url: z.string().describe("짝이 되는 사이트 경로. 없으면 빈 문자열"),
      confidence: z.number(),
      reason: z.string(),
    })
  ),
});

const CompareSchema = z.object({
  findings: z.array(
    z.object({
      category: z.enum(["불일치", "누락", "결함", "확인 필요", "제안"]),
      severity: z.enum(["높음", "보통", "낮음"]),
      title: z.string(),
      expected: z.string().describe("기획(Figma·디스크립션)에서 정한 것"),
      actual: z.string().describe("실제 사이트에 구현된 것"),
      evidence: z.string().describe("기획 쪽 인용 / 사이트 쪽 인용"),
      confidence: z.number(),
    })
  ),
  questions: z.array(z.string()),
});

const MAP_SYSTEM = `Figma 기획서의 화면 목록과 실제 사이트에서 읽은 화면 목록이 주어집니다.
각 Figma 화면이 사이트의 어느 경로와 같은 화면인지 짝지어요.
- 화면 제목, 주요 문구, 필드 이름이 겹치는 정도로 판단해요.
- 짝이 없으면 url을 빈 문자열로 두고 이유를 적어요. 억지로 짝짓지 않아요.
- 한 사이트 경로에 여러 Figma 화면이 짝지어질 수 있어요 (예: PC와 MO).
- 모든 문장은 한국어 해요체로 짧게 써요.`;

const COMPARE_SYSTEM = `당신은 한국어 서비스의 QA를 맡은 시니어 기획자입니다.
Figma 기획 화면(텍스트, 디스크립션, 이미지)과, 같은 화면을 실제 개발 서버에서 읽은 결과(텍스트, 스크린샷)가 주어집니다.
기획대로 구현됐는지 비교해요.

찾을 것:
- 불일치: 기획과 다르게 구현됨 (문구, 라벨, 필드 순서, 선택지, 단위, 버튼 이름, 배치)
- 누락: 기획에 있는데 사이트에 없음 (필드, 버튼, 안내 문구, 탭)
- 결함: 화면이 깨지거나, 값이 비어 있거나, 오류 문구가 보이는 등 동작 문제
- 확인 필요: 사이트에만 있고 기획에 없는 요소처럼, 의도인지 판단이 필요한 것
- 제안: 오류는 아니지만 고치면 좋은 것

규칙:
- 반드시 양쪽 근거를 인용해요. 형식: "기획: … / 사이트: …"
- 샘플 데이터(이름, 번호, 날짜, 금액, 건수)는 다를 수 있으니 문제로 보지 않아요. 단위·표기 형식이 다르면 보고해요.
- 주석(anno/)과 디스크립션 번호는 기획자의 설명이라 화면 요소로 보지 않아요.
- 이 화면은 기본 상태로 열어본 것이에요. 오류·빈 상태·완료 같은 다른 상태 화면은 비교하지 않아요.
- 확신이 0.6 미만이면 보고하지 않아요. findings는 최대 6개, questions는 최대 2개.
- 문제가 없으면 빈 배열을 반환해요. 모든 문장은 한국어 해요체로 짧게 써요.`;

type Knowledge = { screen: string; q: string; a: string }[];

function lines(label: string, texts: string[]): string {
  return `## ${label}\n${texts.map((t, i) => `${i + 1}. ${t.replace(/\s*\n\s*/g, " ⏎ ")}`).join("\n") || "(없음)"}`;
}

function setRun(runId: string, fields: Record<string, string | number | null>) {
  const keys = Object.keys(fields);
  getDb()
    .prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), runId);
}

function addFinding(
  roundId: string,
  runId: string,
  screen: string,
  f: { category: string; severity: string; title: string; expected: string; actual: string; evidence: string; confidence: number | null },
  source: "ai" | "rule"
) {
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

// 프로젝트에 확정된 매핑 (사람이 고친 것 우선)
export function savedMappings(projectId: string): Map<string, { url: string; confirmed: boolean }> {
  const rows = getDb().prepare("SELECT screen_key, url, confirmed FROM mappings WHERE project_id = ?").all(projectId) as unknown as {
    screen_key: string;
    url: string;
    confirmed: number;
  }[];
  return new Map(rows.map((r) => [r.screen_key, { url: r.url, confirmed: r.confirmed === 1 }]));
}

function saveMapping(projectId: string, screen: string, url: string, confidence: number, reason: string) {
  getDb()
    .prepare(
      `INSERT INTO mappings (id, project_id, screen_key, url, confidence, reason, confirmed) VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(project_id, screen_key) DO UPDATE SET url = excluded.url, confidence = excluded.confidence, reason = excluded.reason
       WHERE mappings.confirmed = 0`
    )
    .run(newId(), projectId, screen, url, confidence, reason);
}

function compareContent(s: PlanScreen, snap: PlanSnapshot, page: SitePage, knowledge: Knowledge): Anthropic.Beta.BetaContentBlockParam[] {
  const base = !s.desc && s.state ? snap.screens.find((x) => x.base === s.base && !x.state && x.platform === s.platform) : null;
  const desc = s.desc ?? base?.desc ?? null;
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  const img = (p?: string) => {
    if (!p) return;
    try {
      blocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(p).toString("base64") } });
    } catch {
      // 이미지 없이 텍스트만
    }
  };
  blocks.push({ type: "text", text: "첫 번째 이미지: Figma 기획 화면" });
  img(s.imagePath);
  blocks.push({ type: "text", text: "두 번째 이미지: 실제 사이트 화면" });
  img(page.screenshot);
  const rel = knowledge.filter((k) => !k.screen || k.screen === s.key);
  blocks.push({
    type: "text",
    text: [
      `# Figma 화면 ${s.key} ↔ 사이트 ${page.url} (${page.viewport})`,
      rel.length ? `## 기획자가 이미 답한 내용\n${rel.map((k) => `- Q: ${k.q}\n  A: ${k.a}`).join("\n")}` : "",
      lines("기획 화면 텍스트", s.texts.map((t) => `[${t.layer}] ${t.text}`)),
      lines("디스크립션", (desc?.texts ?? []).map((t) => t.text)),
      lines("사이트 화면 텍스트 (읽는 순서)", page.texts),
    ].join("\n\n"),
  });
  return blocks;
}

export async function runImplReview(runId: string): Promise<void> {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as { id: string; round_id: string; scope: string } | undefined;
  if (!run) return;
  const round = getRound(run.round_id)!;
  const project = getProject(round.project_id)!;
  const model = currentModel();
  const budget = budgetUsd();
  const knowledge = projectKnowledge(project.id);
  let spent = 0;
  const now = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  setRun(runId, { status: "running", started_at: now(), progress: "기획안 읽는 중", phase: "read", done: 0, total: 0, screens: "[]", model, error: null, cost_usd: 0 });

  try {
    if (!project.site_url) throw new AiError("사이트 주소가 없어요. 프로젝트 설정에서 넣어주세요.");
    if (project.figma_links.length === 0) throw new AiError("기획안 링크가 없어요. 프로젝트에 Figma 링크를 넣어주세요.");
    const dir = path.join(process.cwd(), "data", "snapshots", round.id);
    mkdirSync(dir, { recursive: true });

    // 1. 기획 읽기
    const snaps: PlanSnapshot[] = [];
    for (const link of project.figma_links) {
      const snap = await fetchPlanSnapshot(link);
      setRun(runId, { progress: `${snap.sectionName} 화면 이미지 받는 중`, phase: "images" });
      await downloadScreenImages(snap, path.join(dir, "img"));
      snaps.push(snap);
    }
    writeFileSync(path.join(dir, "figma.json"), JSON.stringify(snaps, null, 2));
    const sections = snaps.map((s) => s.sectionName.replace(/\s+/g, " ").trim()).join(", ");
    setRun(runId, { title: run.scope && run.scope !== "전체" ? `${sections} (${run.scope})` : sections });

    // 2. 사이트 읽기 (안전 모드: 로그인 뒤 GET만)
    const mapped = savedMappings(project.id);
    const extra = [...mapped.values()].map((m) => m.url).filter(Boolean);
    const site: SiteSnapshot = await crawlSite({
      baseUrl: project.site_url,
      outDir: path.join(dir, "site"),
      maxPages: 25,
      extraPaths: extra,
      onProgress: (m) => setRun(runId, { progress: m }),
    });
    writeFileSync(path.join(dir, "site.json"), JSON.stringify(site, null, 2));

    // 상태 화면(오류·완료 등)은 클릭·입력이 필요해서 이번 비교에서 제외
    const scope = run.scope && run.scope !== "전체" ? run.scope : "";
    const screens = snaps.flatMap((sn) => sn.screens.map((s) => ({ s, sn }))).filter(({ s }) => !s.state && (!scope || s.key.includes(scope)));

    // 3. 화면 짝짓기: 사람이 확정한 것은 그대로, 나머지는 AI가 제안
    setRun(runId, { progress: "기획 화면과 사이트 화면 짝짓는 중" });
    const toMap = screens.filter(({ s }) => !mapped.get(s.key)?.confirmed);
    if (toMap.length) {
      const { data, cost } = await askStructured({
        model,
        system: MAP_SYSTEM,
        schema: MapSchema,
        content: [
          {
            type: "text",
            text: [
              "# Figma 화면",
              ...toMap.map(({ s }) => `- ${s.key} | ${s.title} | ${s.texts.slice(0, 25).map((t) => t.text).join(" / ").slice(0, 400)}`),
              "",
              "# 사이트 화면",
              ...site.pages.map((p) => `- ${p.url} | ${p.title} | ${p.texts.slice(0, 30).join(" / ").slice(0, 400)}`),
            ].join("\n"),
          },
        ],
      });
      spent += cost;
      for (const m of data.mappings) saveMapping(project.id, m.screen, m.url, m.confidence, m.reason);
    }
    const finalMap = savedMappings(project.id);

    // 짝이 없는 화면은 '확인 필요'로 남긴다
    const pairs: { s: PlanScreen; sn: PlanSnapshot; url: string }[] = [];
    for (const { s, sn } of screens) {
      const url = finalMap.get(s.key)?.url ?? "";
      if (!url) {
        addFinding(round.id, runId, s.key, {
          category: "확인 필요",
          severity: "보통",
          title: "사이트에서 이 화면을 찾지 못했어요",
          expected: `${s.key} 화면`,
          actual: "짝이 되는 사이트 경로 없음 (미구현이거나, 메뉴에서 닿지 않는 화면)",
          evidence: s.title,
          confidence: null,
        }, "rule");
        continue;
      }
      pairs.push({ s, sn, url });
    }

    // 모바일 화면은 같은 경로를 모바일 기기로 다시 읽는다
    const moPaths = [...new Set(pairs.filter((p) => p.s.platform === "MO").map((p) => p.url))];
    const moPages = moPaths.length
      ? await capturePages({ baseUrl: project.site_url, outDir: path.join(dir, "site"), paths: moPaths, viewport: "MO" })
      : [];
    const pageFor = (url: string, platform: string) =>
      platform === "MO" ? moPages.find((p) => p.url === url) : site.pages.find((p) => p.url === url) ?? site.pages.find((p) => p.pattern === url);

    // 콘솔 오류는 경로당 한 번만 결함으로 기록
    const reportedConsole = new Set<string>();
    setRun(runId, { phase: "review", total: pairs.length, done: 0, screens: JSON.stringify(pairs.map((p) => p.s.key)) });
    let done = 0;
    for (const { s, sn, url } of pairs) {
      if (spent >= budget) {
        setRun(runId, { status: "stopped", progress: `비용 상한 $${budget}에 도달해 멈췄어요 (${done}/${pairs.length} 화면)`, cost_usd: spent });
        return;
      }
      setRun(runId, { progress: `${s.key} ↔ ${url} 비교 중 (${done + 1}/${pairs.length})`, cost_usd: spent });
      const page = pageFor(url, s.platform);
      if (!page) {
        addFinding(round.id, runId, s.key, { category: "결함", severity: "보통", title: "사이트 화면을 열지 못했어요", expected: url, actual: "열리지 않음 또는 로그인 화면으로 이동", evidence: url, confidence: null }, "rule");
      } else {
        if (page.consoleErrors.length && !reportedConsole.has(page.url)) {
          reportedConsole.add(page.url);
          addFinding(round.id, runId, s.key, {
            category: "결함",
            severity: "낮음",
            title: `브라우저 콘솔 오류 ${page.consoleErrors.length}건`,
            expected: "콘솔 오류 없음",
            actual: page.consoleErrors[0].slice(0, 200),
            evidence: page.consoleErrors.join("\n").slice(0, 800),
            confidence: 1,
          }, "rule");
        }
        try {
          const { data, cost } = await askStructured({ model, system: COMPARE_SYSTEM, schema: CompareSchema, content: compareContent(s, sn, page, knowledge) });
          spent += cost;
          for (const f of data.findings.filter((x) => x.confidence >= 0.6).slice(0, 6)) addFinding(round.id, runId, s.key, f, "ai");
          for (const q of data.questions.slice(0, 2)) addQuestion(project.id, round.id, runId, s.key, q);
        } catch (e) {
          if (!(e instanceof AiError && /거절|잘렸/.test(e.message))) throw e;
          addQuestion(project.id, round.id, runId, s.key, `이 화면은 자동 비교하지 못했어요: ${e.message}`);
        }
      }
      done++;
      setRun(runId, { done, cost_usd: spent });
    }
    setRun(runId, { status: "done", progress: "완료", phase: "done", cost_usd: spent, finished_at: now() });
  } catch (e) {
    setRun(runId, { status: "failed", progress: "실패", error: e instanceof Error ? e.message : String(e), cost_usd: spent });
  }
}
