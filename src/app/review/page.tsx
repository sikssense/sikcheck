import RunList from "@/components/RunList";
import RunPoller from "@/components/RunPoller";
import { listRunsToReview } from "@/lib/repo";

export default function ReviewPage() {
  const runs = listRunsToReview();
  // 실행 중인 검수도 이미 나온 결과부터 판정할 수 있게 위에 둔다
  const todo = runs.filter((x) => x.todo > 0 || x.run.status === "running");
  const done = runs.filter((x) => x.todo === 0 && x.run.status !== "running");
  return (
    <div className="stack">
      <RunPoller active={runs.some((x) => x.run.status === "running")} />
      <div>
        <h1>검토함</h1>
        <p className="sub">검수 기록별로 모여 있어요. 들어가서 발견을 판정하고 질문에 답해요.</p>
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>확인할 것이 남은 검수 {todo.length}건</h2>
        {todo.length === 0 ? (
          <div className="card empty"><b>확인할 검수가 없어요</b>검수를 실행하면 여기로 모여요.</div>
        ) : (
          <RunList items={todo.map((x) => ({ run: x.run, mode: x.mode, href: x.href, context: `${x.projectName} · ${x.roundName}` }))} />
        )}
      </section>

      {done.length > 0 ? (
        <section className="stack" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>모두 확인한 검수 {done.length}건</h2>
          <RunList items={done.map((x) => ({ run: x.run, mode: x.mode, href: x.href, context: `${x.projectName} · ${x.roundName}` }))} />
        </section>
      ) : null}
    </div>
  );
}
