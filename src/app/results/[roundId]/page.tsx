import Link from "next/link";
import { notFound } from "next/navigation";
import { findingId, judgeLabel, reportFindings } from "@/lib/report";
import { getProject, getRound, getRoundSummary, listRuns, MODE_LABEL, runLabel, VERDICT_LABEL } from "@/lib/repo";

export default async function ReportPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const round = getRound(roundId);
  const sum = getRoundSummary(roundId);
  if (!round || !sum) notFound();
  const project = getProject(round.project_id)!;
  const prev = round.prev_round_id ? getRound(round.prev_round_id) : null;
  const runs = listRuns(roundId).filter((r) => r.status !== "queued");
  const findings = reportFindings(roundId);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  return (
    <div className="stack">
      <div className="head">
        <div>
          <div className="crumb"><Link href="/results">결과</Link> / 결과서</div>
          <h1>{project.name} {round.name} {MODE_LABEL[round.mode]} 결과서</h1>
          <p className="sub">오탐(문제 아님)은 빼고, 심각도 순으로 정리했어요.</p>
        </div>
        <a className="btn primary" href={`/api/report/${roundId}`}>엑셀 다운로드</a>
      </div>

      {sum.pending + sum.open_questions > 0 ? (
        <div className="notice">
          아직 판정하지 않은 항목 {sum.pending}건, 열린 질문 {sum.open_questions}건이 있어요. 판정 전 항목은 결과서에 &lsquo;확인 필요&rsquo;로 들어가요.
        </div>
      ) : null}

      <section className="card paper">
        <div className="paper-head">
          <div>
            <div className="small muted">QA REPORT · {today}</div>
            <h2 style={{ margin: "4px 0 0" }}>{project.name} {round.name} {MODE_LABEL[round.mode]} 결과서</h2>
          </div>
          <div className="sign" aria-label="결재란">
            {["작성", "검토", "승인"].map((t) => (
              <div key={t}><div className="sh">{t}</div><div className="sb" /></div>
            ))}
          </div>
        </div>

        <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
          <dt>이전 버전</dt>
          <dd>{prev ? prev.name : "없음 (처음 검수)"}</dd>
          <dt>환경</dt>
          <dd>{project.env === "prod" ? "운영 (읽기 전용)" : "개발계"}</dd>
          <dt>검수 기록</dt>
          <dd>{runs.map((r) => runLabel(r, round.mode)).join(", ") || "-"}</dd>
        </dl>

        <div className="typecount">
          <div><b>{findings.length}</b><span>결과서 항목</span></div>
          <div><b>{sum.confirmed}</b><span>문제 맞음</span></div>
          <div><b>{sum.plan_change}</b><span>기획 변경</span></div>
          <div><b>{sum.pending}</b><span>확인 필요</span></div>
          <div><b>{sum.dismissed}</b><span>제외</span></div>
        </div>

        <h3 style={{ margin: "8px 0 0" }}>결함 목록</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="table report-table">
            <thead>
              <tr><th>ID</th><th>화면</th><th>유형</th><th>심각도</th><th>제목</th><th>판정</th><th>주체</th></tr>
            </thead>
            <tbody>
              {findings.map((f, i) => (
                <tr key={f.id}>
                  <td className="nowrap">{findingId(round.name, i)}</td>
                  <td className="small">{f.screen_id}</td>
                  <td className="nowrap">{f.type}</td>
                  <td className="nowrap">{f.severity}</td>
                  <td>{f.title}</td>
                  <td className="nowrap">{VERDICT_LABEL[f.verdict]}</td>
                  <td className="nowrap small muted">{judgeLabel(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
