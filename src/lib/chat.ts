import { z } from "zod";
import { getDb, newId } from "./db";
import { askStructured, currentModel } from "./ai";
import {
  answerQuestion,
  createRun,
  getProject,
  getRound,
  getRun,
  listRunFindings,
  listRunQuestions,
  projectKnowledge,
  runLabel,
  setVerdict,
  VERDICT_LABEL,
} from "./repo";
import { runPlanReview } from "./review/plan";
import { runImplReview } from "./review/impl";
import { runChangeReview } from "./review/change";

// 검수 기록 화면의 대화: 사용자의 말을 판정·답변·규칙·재실행으로 바꿔 실제로 반영한다

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; actions: string; created_at: string };

const ActionSchema = z.object({
  reply: z.string().describe("사용자에게 하는 답. 무엇을 했는지 짧게. 해요체"),
  verdicts: z
    .array(
      z.object({
        finding_ids: z.array(z.string()),
        verdict: z.enum(["confirmed", "plan_change", "dismissed"]),
        note: z.string(),
      })
    )
    .describe("판정을 바꿀 발견들. 사용자가 판정을 요청했을 때만"),
  answers: z.array(z.object({ question_id: z.string(), answer: z.string() })).describe("사용자가 질문에 답했을 때만"),
  rules: z.array(z.string()).describe("앞으로 검수할 때 지킬 프로젝트 규칙. 사용자가 기준을 알려줬을 때만"),
  rerun_scope: z.string().describe("다시 검수할 범위(화면 키 일부). 사용자가 재검수를 요청했을 때만, 아니면 빈 문자열"),
});

const SYSTEM = `당신은 기획 검수 도구 '식스체크'의 검수 도우미예요. 한 번의 검수 기록에 대한 발견·질문 목록과 사용자의 말이 주어져요.
사용자의 말을 실제 동작으로 바꿔요.
- 판정 요청 ("이건 문제 아님", "용어 지적은 다 기획 변경으로") → verdicts. finding_ids는 목록에 있는 id만 써요.
- 질문에 대한 답 → answers. question_id는 목록에 있는 id만 써요.
- 앞으로의 기준 ("견적과 렌탈료는 같은 말이야", "샘플 데이터 숫자는 보지 마") → rules
- 다시 검수해 달라는 요청 → rerun_scope (예: "AWP", "MYP-REQ")
- 그냥 물어보는 말이면 동작 없이 reply로 답해요.
요청이 애매하면 동작하지 말고 reply로 되물어요. 하지 않은 일을 했다고 말하지 않아요.
판정 이름은 화면에 보이는 한국어(확인 필요, 문제 맞음, 기획 변경, 문제 아님)로만 말하고, id나 영어 값은 답에 쓰지 않아요.
모든 문장은 한국어 해요체로 짧게 써요.`;

export function listChat(runId: string): ChatMessage[] {
  return getDb().prepare("SELECT * FROM chat_messages WHERE run_id = ? ORDER BY created_at, rowid").all(runId) as unknown as ChatMessage[];
}

function save(runId: string, role: "user" | "assistant", content: string, actions = "") {
  getDb().prepare("INSERT INTO chat_messages (id, run_id, role, content, actions) VALUES (?, ?, ?, ?, ?)").run(newId(), runId, role, content, actions);
}

export async function sendChat(runId: string, text: string): Promise<void> {
  const run = getRun(runId);
  if (!run) return;
  const round = getRound(run.round_id)!;
  const project = getProject(round.project_id)!;
  save(runId, "user", text);

  const findings = listRunFindings(runId);
  const questions = listRunQuestions(runId);
  const history = listChat(runId).slice(-10);
  const context = [
    `# 검수 기록: ${runLabel(run, round.mode)}`,
    "## 발견 (id | 화면 | 유형 | 심각도 | 판정 | 제목)",
    ...findings.map((f) => `${f.id} | ${f.screen_id} | ${f.type} | ${f.severity} | ${VERDICT_LABEL[f.verdict] ?? f.verdict} | ${f.title}`),
    "## 질문 (id | 화면 | 상태 | 질문)",
    ...questions.map((q) => `${q.id} | ${q.screen_id} | ${{ open: "열림", answered: "답변함", skipped: "건너뜀" }[q.status] ?? q.status} | ${q.question}`),
    "## 지금까지 정한 프로젝트 기준",
    ...projectKnowledge(project.id).map((k) => `- ${k.q} → ${k.a}`),
    "## 최근 대화",
    ...history.map((m) => `${m.role === "user" ? "사용자" : "도우미"}: ${m.content}`),
  ].join("\n");

  let reply: string;
  const done: string[] = [];
  try {
    const { data, cost } = await askStructured({
      model: currentModel(),
      system: SYSTEM,
      schema: ActionSchema,
      content: [{ type: "text", text: context }],
    });
    getDb().prepare("UPDATE runs SET cost_usd = cost_usd + ? WHERE id = ?").run(cost, runId);

    const validF = new Set(findings.map((f) => f.id));
    for (const v of data.verdicts) {
      const ids = v.finding_ids.filter((id) => validF.has(id));
      ids.forEach((id) => setVerdict(id, v.verdict, v.note));
      if (ids.length) done.push(`판정 ${ids.length}건 변경`);
    }
    const validQ = new Set(questions.map((q) => q.id));
    const answers = data.answers.filter((a) => validQ.has(a.question_id));
    answers.forEach((a) => answerQuestion(a.question_id, a.answer));
    if (answers.length) done.push(`질문 ${answers.length}건 답변`);
    for (const rule of data.rules) {
      // 규칙은 '답한 질문'으로 저장해 프로젝트 지식이 되게 한다
      getDb()
        .prepare("INSERT INTO questions (id, project_id, round_id, run_id, screen_id, question, answer, status) VALUES (?, ?, ?, ?, '', '프로젝트 규칙', ?, 'answered')")
        .run(newId(), project.id, round.id, runId, rule);
    }
    if (data.rules.length) done.push(`규칙 ${data.rules.length}개 저장`);
    if (data.rerun_scope.trim()) {
      const newRun = createRun(round.id, data.rerun_scope.trim());
      const start = round.mode === "plan" ? runPlanReview : round.mode === "impl" ? runImplReview : runChangeReview;
      void start(newRun);
      done.push(`'${data.rerun_scope.trim()}' 범위로 재검수 시작`);
    }
    reply = data.reply;
  } catch (e) {
    reply = `처리하지 못했어요: ${e instanceof Error ? e.message : String(e)}`;
  }
  save(runId, "assistant", reply, done.join(" · "));
}
