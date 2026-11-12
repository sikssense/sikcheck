import Link from "next/link";
import { listRoundSummaries, MODE_LABEL } from "@/lib/repo";

export default function ResultsPage() {
  const rounds = listRoundSummaries().filter((r) => r.run_count > 0);
  return (
    <div className="stack">
      <div>
        <h1>결과</h1>
        <p className="sub">회차별 결과서예요. 판정한 내용이 바로 반영되고, 표준 양식 엑셀로 내려받을 수 있어요.</p>
      </div>
      {rounds.length === 0 ? (
        <div className="card empty"><b>아직 결과서가 없어요</b>검수를 실행하면 회차별 결과서가 생겨요.</div>
      ) : (
        <div className="runlist">
          {rounds.map((r) => (
            <Link key={r.id} href={`/results/${r.id}`} className="runitem">
              <div>
                <div className="small muted">{r.project_name}</div>
                <div className="runitem-title">{r.name} · {MODE_LABEL[r.mode]} 결과서</div>
                <div className="small muted">검수 기록 {r.run_count}건 · AI 비용 ${r.cost.toFixed(3)}</div>
              </div>
              <div className="runitem-stats">
                <span><b>{r.confirmed}</b> 문제 맞음</span>
                <span><b>{r.plan_change}</b> 기획 변경</span>
                <span><b>{r.dismissed}</b> 제외</span>
                {r.pending + r.open_questions > 0 ? (
                  <span className="todo-badge">확인할 것 {r.pending + r.open_questions}</span>
                ) : (
                  <span className="small muted">판정 완료</span>
                )}
                <span className="arrow" aria-hidden>›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
