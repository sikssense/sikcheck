import Link from "next/link";
import { notFound } from "next/navigation";
import { skipAllQuestionsAction } from "@/app/actions";
import ChatPanel from "@/components/ChatPanel";
import FindingCard from "@/components/FindingCard";
import Legend from "@/components/Legend";
import QuestionCard from "@/components/QuestionCard";
import RunPoller from "@/components/RunPoller";
import RunStatus from "@/components/RunStatus";
import { budgetUsd, MODELS, type ModelId } from "@/lib/ai";
import { getProject, getRound, getRun, listRunFindings, listRunQuestions, runLabel } from "@/lib/repo";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string; roundId: string; runId: string }>;
}) {
  const { id, roundId, runId } = await params;
  const project = getProject(id);
  const round = getRound(roundId);
  const run = getRun(runId);
  if (!project || !round || !run || round.project_id !== id || run.round_id !== roundId) notFound();

  const findings = listRunFindings(runId);
  const questions = listRunQuestions(runId);
  const openQuestions = questions.filter((q) => q.status === "open");
  const byScreen = new Map<string, typeof findings>();
  for (const f of findings) byScreen.set(f.screen_id, [...(byScreen.get(f.screen_id) ?? []), f]);
  const pending = findings.filter((f) => f.verdict === "pending").length;

  return (
    <div className="stack">
      <RunPoller active={run.status === "running"} />
      <div>
        <div className="crumb">
          <Link href="/">홈</Link> / <Link href={`/projects/${id}`}>{project.name}</Link> /{" "}
          <Link href={`/projects/${id}/rounds/${roundId}`}>{round.name}</Link> / 검수 기록
        </div>
        <h1>{runLabel(run, round.mode)}</h1>
        <p className="sub">
          확인 필요 {pending}건 · 열린 질문 {openQuestions.length}건. 판정하고 답하면 결과서에 바로 반영돼요.
        </p>
      </div>

      <RunStatus
        status={run.status}
        finishedAt={run.finished_at}
        error={run.error}
        reviewHref="#findings"
        seq={run.seq}
        scope={run.scope}
        phase={run.phase}
        progress={run.progress}
        done={run.done}
        total={run.total}
        screens={JSON.parse(run.screens || "[]") as string[]}
        costUsd={run.cost_usd ?? 0}
        budgetUsd={budgetUsd()}
        startedAt={run.started_at}
        findings={findings.length}
        questions={questions.length}
        model={MODELS[run.model as ModelId]?.label.split(" · ")[0] ?? ""}
      />

      {run.status !== "running" ? <ChatPanel runId={runId} /> : null}

      <Legend />

      {questions.length > 0 ? (
        <section className="stack" style={{ gap: 8 }}>
          <div className="head">
            <h2 style={{ margin: 0 }}>질문 · 열린 질문 {openQuestions.length}건</h2>
            {openQuestions.length > 0 ? (
              <form action={skipAllQuestionsAction}>
                <input type="hidden" name="run_id" value={runId} />
                <button className="btn" type="submit">열린 질문 모두 건너뛰기</button>
              </form>
            ) : null}
          </div>
          {openQuestions.map((q) => <QuestionCard key={q.id} q={q} />)}
          {questions.length > openQuestions.length ? (
            <details className="legend-box">
              <summary>답했거나 건너뛴 질문 {questions.length - openQuestions.length}건 보기</summary>
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                {questions.filter((q) => q.status !== "open").map((q) => <QuestionCard key={q.id} q={q} />)}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="stack" style={{ gap: 8 }} id="findings">
        <h2 style={{ margin: 0 }}>발견 {findings.length}건</h2>
        {findings.length === 0 ? (
          <div className="card empty">
            <b>{run.status === "running" ? "검수 중이에요" : "발견이 없어요"}</b>
            {run.status === "running" ? "화면별로 결과가 들어오면 여기에 쌓여요." : ""}
          </div>
        ) : (
          [...byScreen.entries()].map(([screen, list]) => (
            <div key={screen} className="screen-group">
              <h3>{screen} · {list.length}건</h3>
              {list.map((f) => <FindingCard key={f.id} f={f} context=" " />)}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
