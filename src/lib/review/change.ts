import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb, newId } from "../db";
import { getProject, getRound } from "../repo";
import { fetchPlanSnapshot, type PlanSnapshot } from "../figma";
import { crawlSite, type SiteSnapshot } from "../site";
import { savedMappings } from "./impl";

// 변경 검수: 이전 회차 스냅샷과 지금을 비교한다. AI를 쓰지 않아 비용이 없다.
//   기획 변경 + 사이트 변경 → 기획대로 변경
//   사이트만 변경            → 근거 없는 변경
//   기획만 변경              → 반영 누락

const snapDir = (roundId: string) => path.join(process.cwd(), "data", "snapshots", roundId);

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

// 숫자·날짜는 샘플 데이터라 비교에서 뺀다
const norm = (t: string) => t.replace(/\s+/g, " ").replace(/\d[\d,.:/-]*/g, "#").trim();

function diff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before.map(norm));
  const a = new Set(after.map(norm));
  return {
    added: after.filter((t) => !b.has(norm(t))),
    removed: before.filter((t) => !a.has(norm(t))),
  };
}

const planTexts = (snaps: PlanSnapshot[]) => {
  const m = new Map<string, string[]>();
  for (const sn of snaps)
    for (const s of sn.screens) m.set(s.key, [...s.texts.map((t) => t.text), ...(s.desc?.texts.map((t) => t.text) ?? [])]);
  return m;
};

const siteTexts = (snap: SiteSnapshot | null) => new Map((snap?.pages ?? []).map((p) => [p.pattern, p.texts]));

function sample(list: string[], n = 8) {
  return list.slice(0, n).map((t) => `· ${t.slice(0, 80)}`).join("\n") + (list.length > n ? `\n… 외 ${list.length - n}개` : "");
}

function setRun(runId: string, fields: Record<string, string | number | null>) {
  const keys = Object.keys(fields);
  getDb()
    .prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), runId);
}

function add(roundId: string, runId: string, screen: string, severity: string, title: string, expected: string, actual: string, evidence: string) {
  getDb()
    .prepare(
      `INSERT INTO findings (id, round_id, run_id, screen_id, type, severity, title, expected, actual, evidence, judge, confidence, source)
       VALUES (?, ?, ?, ?, '변경', ?, ?, ?, ?, ?, 'ai', 1, 'rule')`
    )
    .run(newId(), roundId, runId, screen, severity, title, expected, actual, evidence);
}

export async function runChangeReview(runId: string): Promise<void> {
  const run = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as { id: string; round_id: string; scope: string } | undefined;
  if (!run) return;
  const round = getRound(run.round_id)!;
  const project = getProject(round.project_id)!;
  const now = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  setRun(runId, { status: "running", started_at: now(), progress: "이전 회차 불러오는 중", phase: "read", done: 0, total: 0, screens: "[]", model: "rule", error: null, cost_usd: 0 });

  try {
    if (!round.prev_round_id) throw new Error("이전 버전이 연결되지 않았어요. 회차를 만들 때 이전 버전을 골라주세요.");
    const prev = getRound(round.prev_round_id)!;
    const prevPlan = readJson<PlanSnapshot[]>(path.join(snapDir(prev.id), "figma.json"));
    const prevSite = readJson<SiteSnapshot>(path.join(snapDir(prev.id), "site.json"));
    if (!prevPlan) throw new Error(`이전 회차(${prev.name})에 기획 스냅샷이 없어요. 이전 회차를 한 번 실행해야 비교할 수 있어요.`);

    const dir = snapDir(round.id);
    mkdirSync(dir, { recursive: true });
    setRun(runId, { progress: "지금 기획안 읽는 중" });
    const curPlan: PlanSnapshot[] = [];
    for (const link of project.figma_links) curPlan.push(await fetchPlanSnapshot(link));
    writeFileSync(path.join(dir, "figma.json"), JSON.stringify(curPlan, null, 2));
    setRun(runId, { title: `${prev.name} 대비 ${curPlan.map((s) => s.sectionName.replace(/\s+/g, " ").trim()).join(", ")}` });

    let curSite: SiteSnapshot | null = null;
    if (prevSite && project.site_url) {
      curSite = await crawlSite({
        baseUrl: project.site_url,
        outDir: path.join(dir, "site"),
        maxPages: 25,
        extraPaths: prevSite.pages.map((p) => p.url),
        onProgress: (m) => setRun(runId, { progress: m }),
      });
      writeFileSync(path.join(dir, "site.json"), JSON.stringify(curSite, null, 2));
    }

    setRun(runId, { progress: "변경점 계산 중", phase: "review" });
    const pb = planTexts(prevPlan);
    const pa = planTexts(curPlan);
    const sb = siteTexts(prevSite);
    const sa = siteTexts(curSite);
    const map = savedMappings(project.id);
    const scope = run.scope && run.scope !== "전체" ? run.scope : "";
    const keys = [...new Set([...pb.keys(), ...pa.keys()])].filter((k) => !scope || k.includes(scope)).sort();
    setRun(runId, { total: keys.length, screens: JSON.stringify(keys) });

    const usedSite = new Set<string>();
    let done = 0;
    for (const key of keys) {
      const before = pb.get(key);
      const after = pa.get(key);
      if (!before) {
        add(round.id, runId, key, "낮음", "기획에 새 화면이 생겼어요", `${prev.name}에는 없음`, "이번 기획에 추가", key);
      } else if (!after) {
        add(round.id, runId, key, "보통", "기획에서 화면이 사라졌어요", `${prev.name}에 있던 화면`, "이번 기획에 없음", key);
      } else {
        const pd = diff(before, after);
        const planChanged = pd.added.length + pd.removed.length > 0;
        const url = map.get(key)?.url;
        const pattern = url ? url.split("?")[0].replace(/\/\d+(?=\/|$)/g, "/{id}") : "";
        const sBefore = pattern ? sb.get(pattern) : undefined;
        const sAfter = pattern ? sa.get(pattern) : undefined;
        if (pattern) usedSite.add(pattern);
        const sd = sBefore && sAfter ? diff(sBefore, sAfter) : null;
        const siteChanged = !!sd && sd.added.length + sd.removed.length > 0;
        const planEv = planChanged ? `[기획] 추가\n${sample(pd.added)}\n[기획] 삭제\n${sample(pd.removed)}` : "";
        const siteEv = siteChanged && sd ? `[사이트 ${url}] 추가\n${sample(sd.added)}\n[사이트] 삭제\n${sample(sd.removed)}` : "";

        if (planChanged && siteChanged) {
          add(round.id, runId, key, "낮음", "기획과 사이트가 함께 바뀌었어요 (기획대로 변경인지 확인)", "기획 변경이 사이트에 반영", "사이트도 변경됨", `${planEv}\n\n${siteEv}`);
        } else if (planChanged && sd) {
          add(round.id, runId, key, "높음", "기획은 바뀌었는데 사이트는 그대로예요 (반영 누락)", "기획 변경 반영", `사이트 ${url} 변화 없음`, planEv);
        } else if (planChanged) {
          add(round.id, runId, key, "보통", "기획이 바뀌었어요", `${prev.name} 기획`, "이번 기획", planEv);
        } else if (siteChanged) {
          add(round.id, runId, key, "높음", "기획 변경 없이 사이트가 바뀌었어요 (근거 없는 변경)", "기획 그대로", `사이트 ${url} 변경`, siteEv);
        }
      }
      done++;
      setRun(runId, { done });
    }

    // 짝이 없는 사이트 화면의 변경
    for (const [pattern, after] of sa) {
      if (usedSite.has(pattern)) continue;
      const before = sb.get(pattern);
      if (!before) {
        add(round.id, runId, `사이트 ${pattern}`, "보통", "사이트에 새 화면이 생겼어요 (기획과 짝 없음)", "기획 화면", "짝 없는 새 화면", pattern);
        continue;
      }
      const sd = diff(before, after);
      if (sd.added.length + sd.removed.length > 0) {
        add(round.id, runId, `사이트 ${pattern}`, "보통", "기획과 짝 없는 사이트 화면이 바뀌었어요", "변경 근거", "사이트 변경", `추가\n${sample(sd.added)}\n삭제\n${sample(sd.removed)}`);
      }
    }
    setRun(runId, { status: "done", progress: "완료", phase: "done", finished_at: now() });
  } catch (e) {
    setRun(runId, { status: "failed", progress: "실패", error: e instanceof Error ? e.message : String(e) });
  }
}
