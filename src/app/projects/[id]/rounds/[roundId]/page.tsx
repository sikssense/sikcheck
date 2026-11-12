import Link from "next/link";
import { notFound } from "next/navigation";
import { addRunAction, startRunAction } from "@/app/actions";
import RunList from "@/components/RunList";
import RunPoller from "@/components/RunPoller";
import RunStatus from "@/components/RunStatus";
import { budgetUsd, currentModel, MODELS, type ModelId } from "@/lib/ai";
import { estimateRun } from "@/lib/estimate";
import {
  ENV_LABEL,
  getProject,
  getRound,
  listFindings,
  listQuestions,
  listRuns,
  MODE_DESC,
  MODE_LABEL,
} from "@/lib/repo";

const RUN_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  failed: "실패",
  stopped: "상한 도달",
};

export default async function RoundPage({
  params,
}: {
  params: Promise<{ id: string; roundId: string }>;
}) {
  const { id, roundId } = await params;
  const project = getProject(id);
  const round = getRound(roundId);
  if (!project || !round || round.project_id !== id) notFound();
  const runs = listRuns(roundId);
  const findings = listFindings(roundId);
  const questions = listQuestions({ roundId });
  const prev = round.prev_round_id ? getRound(round.prev_round_id) : null;
  const needsSite = round.mode !== "plan";
  // 실행 중인 것, 없으면 가장 최근에 끝난 실행을 상태 카드로 보여준다
  const active = runs.find((r) => r.status === "running");
  const running = Boolean(active);
  const shown = active;
  const finished = runs.filter((r) => r.status !== "queued" && r.status !== "running");
  const totalCost = runs.reduce((a, r) => a + (r.cost_usd ?? 0), 0);

  const byScreen = new Map<string, typeof findings>();
  for (const f of findings) byScreen.set(f.screen_id, [...(byScreen.get(f.screen_id) ?? []), f]);
  const pending = findings.filter((f) => f.verdict === "pending").length;

  return (
    <div className="stack">
      <RunPoller active={running} />
      <div>
        <div className="crumb">
          <Link href="/">홈</Link> / <Link href={`/projects/${id}`}>{project.name}</Link> / 회차
        </div>
        <div className="row">
          <h1>{round.name}</h1>
          <span className={`chip ${round.mode}`}>{MODE_LABEL[round.mode]}</span>
        </div>
        <p className="sub">{MODE_DESC[round.mode]}</p>
      </div>

      {shown ? (
        <RunStatus
          status={shown.status}
          finishedAt={shown.finished_at}
          error={shown.error}
          reviewHref={`/projects/${id}/rounds/${roundId}/runs/${shown.id}`}
          seq={shown.seq}
          scope={shown.scope}
          phase={shown.phase}
          progress={shown.progress}
          done={shown.done}
          total={shown.total}
          screens={JSON.parse(shown.screens || "[]") as string[]}
          costUsd={shown.cost_usd ?? 0}
          budgetUsd={budgetUsd()}
          startedAt={shown.started_at}
          findings={findings.filter((f) => f.run_id === shown.id).length}
          questions={questions.filter((q) => q.run_id === shown.id).length}
          model={MODELS[shown.model as ModelId]?.label.split(" · ")[0] ?? ""}
        />
      ) : null}

      {needsSite && !project.site_url ? (
        <div className="notice">이 회차는 사이트가 필요해요. 프로젝트 설정에서 사이트 주소를 넣어주세요.</div>
      ) : null}
      {round.mode === "change" && !round.prev_round_id ? (
        <div className="notice">변경 검수는 이전 버전이 연결돼야 해요. 프로젝트 화면에서 이전 버전을 골라 회차를 새로 만들어 주세요.</div>
      ) : null}
      {project.figma_links.length === 0 ? (
        <div className="notice">기획안 링크가 없어요. 프로젝트 설정에서 Figma 링크를 넣어주세요.</div>
      ) : null}

      <div className="two">
        <section className="card">
          <div className="head">
            <h2>실행</h2>
            <span className="small muted">누적 비용 ${totalCost.toFixed(3)}</span>
          </div>
          {runs.length === 0 ? (
            <div className="empty"><b>아직 실행이 없어요</b></div>
          ) : (
            <table className="table">
              <thead><tr><th>#</th><th>범위</th><th>상태</th><th>비용 · 견적</th><th></th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>#{r.seq}</td>
                    <td>
                      {r.scope}
                      {r.progress && r.status !== "queued" ? <div className="progress-line">{r.progress}</div> : null}
                      {r.error ? <div className="progress-line" style={{ color: "var(--def)" }}>{r.error}</div> : null}
                    </td>
                    <td><span className={`chip ${r.status}`}>{RUN_LABEL[r.status] ?? r.status}</span></td>
                    <td className="small muted">
                      {r.status === "queued" ? (
                        (() => {
                          const est = estimateRun(id, round.mode, r.scope);
                          const over = est.usd !== null && est.usd > budgetUsd();
                          return (
                            <span title="지난 실행의 화면당 실제 비용으로 계산했어요">
                              {est.text}
                              {over ? (
                                <div style={{ color: "var(--def)" }}>
                                  상한 ${budgetUsd()}를 넘어 중간에 멈춰요 · <Link href="/settings" style={{ textDecoration: "underline" }}>설정에서 올리기</Link>
                                </div>
                              ) : null}
                            </span>
                          );
                        })()
                      ) : (
                        <>
                          {r.cost_usd ? `$${r.cost_usd.toFixed(3)}` : "-"}
                          {r.model ? <div>{MODELS[r.model as ModelId]?.label.split(" · ")[0] ?? r.model}</div> : null}
                        </>
                      )}
                    </td>
                    <td>
                      {r.status === "queued" ? (
                        <form action={startRunAction}>
                          <input type="hidden" name="run_id" value={r.id} />
                          <button className="btn primary" type="submit">
                            실행 · {MODELS[currentModel()].label.split(" · ")[0]}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form action={addRunAction} className="row" style={{ marginTop: 14 }}>
            <input type="hidden" name="round_id" value={roundId} />
            <input type="hidden" name="project_id" value={id} />
            <input type="text" name="scope" placeholder="범위 (비우면 전체 · 예: AWP, NotFound)" style={{ flex: 1, minWidth: 200 }} />
            <button className="btn" type="submit">실행 추가</button>
          </form>
        </section>

        <section className="card">
          <h2>회차 정보</h2>
          <dl className="kv">
            <dt>이전 버전</dt>
            <dd>{prev ? prev.name : "없음 (처음 검수)"}</dd>
            <dt>환경</dt>
            <dd>{ENV_LABEL[project.env]}{project.env === "prod" ? " · 읽기 전용" : ""}</dd>
            <dt>사이트</dt>
            <dd>{project.site_url || "-"}</dd>
            <dt>기획안</dt>
            <dd>{project.figma_links.length ? `${project.figma_links.length}개` : "-"}</dd>
            <dt>발견</dt>
            <dd>{findings.length}건 · 확인 필요 {pending}건 · 질문 {questions.filter((q) => q.status === "open").length}건</dd>
          </dl>
        </section>
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>검수 기록</h2>
        {finished.length === 0 ? (
          <div className="card empty">
            <b>{running ? "검수 중이에요" : "아직 검수 기록이 없어요"}</b>
            {running ? "끝나면 날짜별 검수 기록으로 여기에 남아요." : "위에서 실행을 누르면 날짜별 검수 기록이 여기에 쌓여요."}
          </div>
        ) : (
          <RunList items={finished.map((r) => ({ run: r, mode: round.mode, href: `/projects/${id}/rounds/${roundId}/runs/${r.id}` }))} />
        )}
      </section>
    </div>
  );
}
