import { getDb, newId } from "./db";

export type Mode = "plan" | "impl" | "change";
export type Env = "dev" | "prod";

export const MODE_LABEL: Record<Mode, string> = {
  plan: "기획 검수",
  impl: "구현 검수",
  change: "변경 검수",
};
export const MODE_DESC: Record<Mode, string> = {
  plan: "Figma만 보고 기획서 자체의 누락·불일치·충돌을 찾아요",
  impl: "기획대로 사이트가 만들어졌는지 비교해요",
  change: "이전 회차 대비 무엇이 바뀌었는지 정리해요",
};
export const ENV_LABEL: Record<Env, string> = { dev: "개발계", prod: "운영" };

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  site_url: string;
  env: Env;
  figma_links: string[];
  created_at: string;
};
export type Round = {
  id: string;
  project_id: string;
  name: string;
  mode: Mode;
  prev_round_id: string | null;
  status: string;
  created_at: string;
};
export type Run = {
  id: string;
  round_id: string;
  seq: number;
  scope: string;
  status: string;
  progress: string;
  cost_usd: number;
  error: string | null;
  model: string | null;
  phase: string;
  done: number;
  total: number;
  screens: string;
  title: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type ProjectRow = Omit<Project, "figma_links"> & { figma_links: string };
const toProject = (r: ProjectRow): Project => ({ ...r, figma_links: JSON.parse(r.figma_links) });

export function listProjects(): (Project & { round_count: number; last_round: string | null })[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, COUNT(r.id) AS round_count, MAX(r.created_at) AS last_round
       FROM projects p LEFT JOIN rounds r ON r.project_id = p.id
       GROUP BY p.id ORDER BY p.created_at DESC`
    )
    .all() as unknown as (ProjectRow & { round_count: number; last_round: string | null })[];
  return rows.map((r) => ({ ...toProject(r), round_count: r.round_count, last_round: r.last_round }));
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function createProject(input: {
  name: string;
  description?: string;
  site_url?: string;
  env?: Env;
  figma_links?: string[];
}): string {
  const id = newId();
  getDb().prepare(
    `INSERT INTO projects (id, workspace_id, name, description, site_url, env, figma_links)
     VALUES (?, 'ws-personal', ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.description ?? "",
    input.site_url ?? "",
    input.env ?? "dev",
    JSON.stringify(input.figma_links ?? [])
  );
  return id;
}

export function updateProjectSources(id: string, site_url: string, env: Env, figma_links: string[]) {
  getDb().prepare("UPDATE projects SET site_url = ?, env = ?, figma_links = ? WHERE id = ?").run(
    site_url,
    env,
    JSON.stringify(figma_links),
    id
  );
}

export function listRounds(projectId: string): (Round & { run_count: number; finding_count: number })[] {
  return getDb()
    .prepare(
      `SELECT r.*,
        (SELECT COUNT(*) FROM runs x WHERE x.round_id = r.id) AS run_count,
        (SELECT COUNT(*) FROM findings f WHERE f.round_id = r.id) AS finding_count
       FROM rounds r WHERE r.project_id = ? ORDER BY r.created_at DESC`
    )
    .all(projectId) as unknown as (Round & { run_count: number; finding_count: number })[];
}

export function getRound(id: string): Round | null {
  return (getDb().prepare("SELECT * FROM rounds WHERE id = ?").get(id) as Round | undefined) ?? null;
}

export function createRound(input: {
  project_id: string;
  name: string;
  mode: Mode;
  prev_round_id?: string | null;
}): string {
  const id = newId();
  getDb().prepare(
    "INSERT INTO rounds (id, project_id, name, mode, prev_round_id) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.project_id, input.name, input.mode, input.prev_round_id || null);
  return id;
}

export function listRuns(roundId: string): Run[] {
  return getDb()
    .prepare("SELECT * FROM runs WHERE round_id = ? ORDER BY seq DESC")
    .all(roundId) as unknown as Run[];
}

export function createRun(roundId: string, scope: string): string {
  const id = newId();
  const { n } = getDb()
    .prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM runs WHERE round_id = ?")
    .get(roundId) as { n: number };
  getDb().prepare("INSERT INTO runs (id, round_id, seq, scope) VALUES (?, ?, ?, ?)").run(
    id,
    roundId,
    n + 1,
    scope || "전체"
  );
  return id;
}

export function countOpen(): { findings: number; questions: number } {
  const f = getDb()
    .prepare("SELECT COUNT(*) AS n FROM findings WHERE verdict = 'pending'")
    .get() as { n: number };
  const q = getDb().prepare("SELECT COUNT(*) AS n FROM questions WHERE status = 'open'").get() as {
    n: number;
  };
  return { findings: f.n, questions: q.n };
}

export function parseLinks(text: string): string[] {
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^https:\/\/(www\.)?figma\.com\//.test(s));
}

export type Finding = {
  id: string;
  round_id: string;
  run_id: string | null;
  screen_id: string;
  type: string;
  severity: string;
  title: string;
  expected: string;
  actual: string;
  evidence: string;
  judge: string;
  confidence: number | null;
  verdict: string;
  status: string;
  source: string;
  note: string;
  created_at: string;
};
export type Question = {
  id: string;
  project_id: string;
  round_id: string | null;
  run_id: string | null;
  screen_id: string;
  question: string;
  answer: string | null;
  status: string;
  created_at: string;
};

export const VERDICT_LABEL: Record<string, string> = {
  pending: "확인 필요",
  confirmed: "문제 맞음",
  plan_change: "기획 변경",
  dismissed: "문제 아님",
};

const SEVERITY_ORDER = "CASE severity WHEN '높음' THEN 0 WHEN '보통' THEN 1 ELSE 2 END";

export function listFindings(roundId: string): Finding[] {
  return getDb()
    .prepare(`SELECT * FROM findings WHERE round_id = ? ORDER BY screen_id, ${SEVERITY_ORDER}, created_at`)
    .all(roundId) as unknown as Finding[];
}

export function listPendingFindings(): (Finding & { project_id: string; project_name: string; round_name: string })[] {
  return getDb()
    .prepare(
      `SELECT f.*, p.id AS project_id, p.name AS project_name, r.name AS round_name
       FROM findings f JOIN rounds r ON r.id = f.round_id JOIN projects p ON p.id = r.project_id
       WHERE f.verdict = 'pending' ORDER BY f.created_at DESC, ${SEVERITY_ORDER}`
    )
    .all() as unknown as (Finding & { project_id: string; project_name: string; round_name: string })[];
}

export function listQuestions(opts: { roundId?: string; openOnly?: boolean }): (Question & { project_name: string })[] {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.roundId) {
    where.push("q.round_id = ?");
    args.push(opts.roundId);
  }
  if (opts.openOnly) where.push("q.status = 'open'");
  return getDb()
    .prepare(
      `SELECT q.*, p.name AS project_name FROM questions q JOIN projects p ON p.id = q.project_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY q.created_at DESC`
    )
    .all(...args) as unknown as (Question & { project_name: string })[];
}

export function setVerdict(findingId: string, verdict: string, note: string) {
  getDb().prepare("UPDATE findings SET verdict = ?, judge = 'human', note = ? WHERE id = ?").run(verdict, note, findingId);
}

export function answerQuestion(questionId: string, answer: string) {
  getDb().prepare("UPDATE questions SET answer = ?, status = 'answered' WHERE id = ?").run(answer, questionId);
}

export function getRun(id: string): Run | null {
  return (getDb().prepare("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined) ?? null;
}

export function skipQuestion(questionId: string) {
  getDb().prepare("UPDATE questions SET status = 'skipped' WHERE id = ?").run(questionId);
}

export function skipOpenQuestions(roundId: string) {
  getDb().prepare("UPDATE questions SET status = 'skipped' WHERE round_id = ? AND status = 'open'").run(roundId);
}

// "11월 12일 · D. AST 자산신청 기획 검수" 같은 실행 이름
export function runLabel(run: Run, mode: Mode): string {
  const when = run.started_at ?? run.created_at;
  const [, m, d] = when.slice(0, 10).split("-").map(Number);
  const what = run.title || (run.scope && run.scope !== "전체" ? run.scope : "전체");
  return `${m}월 ${d}일 · ${what} ${MODE_LABEL[mode]}`;
}

export function runCounts(runId: string): { findings: number; pending: number; questions: number; openQuestions: number } {
  const f = getDb()
    .prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN verdict = 'pending' THEN 1 ELSE 0 END) AS p FROM findings WHERE run_id = ?")
    .get(runId) as { n: number; p: number | null };
  const q = getDb()
    .prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS o FROM questions WHERE run_id = ?")
    .get(runId) as { n: number; o: number | null };
  return { findings: f.n, pending: f.p ?? 0, questions: q.n, openQuestions: q.o ?? 0 };
}

export function listRunFindings(runId: string): Finding[] {
  return getDb()
    .prepare(`SELECT * FROM findings WHERE run_id = ? ORDER BY screen_id, ${SEVERITY_ORDER}, created_at`)
    .all(runId) as unknown as Finding[];
}

export function listRunQuestions(runId: string): Question[] {
  return getDb().prepare("SELECT * FROM questions WHERE run_id = ? ORDER BY created_at").all(runId) as unknown as Question[];
}

export function skipRunQuestions(runId: string) {
  getDb().prepare("UPDATE questions SET status = 'skipped' WHERE run_id = ? AND status = 'open'").run(runId);
}

export function listRunsToReview(): { run: Run; mode: Mode; href: string; projectName: string; roundName: string; todo: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT x.*, r.mode AS r_mode, r.name AS r_name, p.id AS p_id, p.name AS p_name
       FROM runs x JOIN rounds r ON r.id = x.round_id JOIN projects p ON p.id = r.project_id
       WHERE x.status != 'queued' ORDER BY COALESCE(x.started_at, x.created_at) DESC`
    )
    .all() as unknown as (Run & { r_mode: Mode; r_name: string; p_id: string; p_name: string })[];
  return rows.map(({ r_mode, r_name, p_id, p_name, ...run }) => {
    const c = runCounts(run.id);
    return {
      run,
      mode: r_mode,
      href: `/projects/${p_id}/rounds/${run.round_id}/runs/${run.id}`,
      projectName: p_name,
      roundName: r_name,
      todo: c.pending + c.openQuestions,
    };
  });
}

// 답변한 질문 = 프로젝트 지식. 다음 검수 때 기준으로 함께 보낸다.
export function projectKnowledge(projectId: string): { screen: string; q: string; a: string }[] {
  return (
    getDb()
      .prepare("SELECT screen_id, question, answer FROM questions WHERE project_id = ? AND status = 'answered' ORDER BY created_at")
      .all(projectId) as unknown as { screen_id: string; question: string; answer: string }[]
  ).map((r) => ({ screen: r.screen_id, q: r.question, a: r.answer }));
}

export type RoundSummary = Round & {
  project_name: string;
  run_count: number;
  findings: number;
  pending: number;
  confirmed: number;
  plan_change: number;
  dismissed: number;
  open_questions: number;
  cost: number;
};

export function listRoundSummaries(): RoundSummary[] {
  return getDb()
    .prepare(
      `SELECT r.*, p.name AS project_name,
        (SELECT COUNT(*) FROM runs x WHERE x.round_id = r.id AND x.status != 'queued') AS run_count,
        (SELECT COUNT(*) FROM findings f WHERE f.round_id = r.id) AS findings,
        (SELECT COUNT(*) FROM findings f WHERE f.round_id = r.id AND f.verdict = 'pending') AS pending,
        (SELECT COUNT(*) FROM findings f WHERE f.round_id = r.id AND f.verdict = 'confirmed') AS confirmed,
        (SELECT COUNT(*) FROM findings f WHERE f.round_id = r.id AND f.verdict = 'plan_change') AS plan_change,
        (SELECT COUNT(*) FROM findings f WHERE f.round_id = r.id AND f.verdict = 'dismissed') AS dismissed,
        (SELECT COUNT(*) FROM questions q WHERE q.round_id = r.id AND q.status = 'open') AS open_questions,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM runs x WHERE x.round_id = r.id) AS cost
       FROM rounds r JOIN projects p ON p.id = r.project_id ORDER BY r.created_at DESC`
    )
    .all() as unknown as RoundSummary[];
}

export function getRoundSummary(roundId: string): RoundSummary | null {
  return listRoundSummaries().find((r) => r.id === roundId) ?? null;
}

export type Mapping = { screen_key: string; url: string; confidence: number | null; reason: string; confirmed: number };

export function listMappings(projectId: string): Mapping[] {
  return getDb()
    .prepare("SELECT screen_key, url, confidence, reason, confirmed FROM mappings WHERE project_id = ? ORDER BY screen_key")
    .all(projectId) as unknown as Mapping[];
}
