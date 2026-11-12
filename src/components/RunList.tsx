import Link from "next/link";
import { runCounts, runLabel, type Mode, type Run } from "@/lib/repo";

const RUN_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  failed: "실패",
  stopped: "상한 도달",
};

// 검수 기록 목록: 눌러서 들어가면 그 검수의 발견·질문을 본다
export default function RunList({
  items,
}: {
  items: { run: Run; mode: Mode; href: string; context?: string }[];
}) {
  return (
    <div className="runlist">
      {items.map(({ run, mode, href, context }) => {
        const c = runCounts(run.id);
        const todo = c.pending + c.openQuestions;
        return (
          <Link key={run.id} href={href} className="runitem">
            <div>
              {context ? <div className="small muted">{context}</div> : null}
              <div className="runitem-title">{runLabel(run, mode)}</div>
              <div className="small muted">
                {(run.started_at ?? run.created_at).slice(11, 16)} 시작 · 실행 #{run.seq}
                {run.cost_usd ? ` · $${run.cost_usd.toFixed(3)}` : ""}
              </div>
            </div>
            <div className="runitem-stats">
              <span className={`chip ${run.status}`}>
                {RUN_LABEL[run.status] ?? run.status}
                {run.status === "running" && run.total ? ` ${run.done}/${run.total}` : ""}
              </span>
              <span><b>{c.findings}</b> 발견</span>
              <span><b>{c.questions}</b> 질문</span>
              {todo > 0 ? <span className="todo-badge">확인할 것 {todo}</span> : <span className="small muted">모두 확인함</span>}
              <span className="arrow" aria-hidden>›</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
