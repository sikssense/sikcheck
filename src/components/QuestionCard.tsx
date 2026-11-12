import { answerAction, skipQuestionAction } from "@/app/actions";
import type { Question } from "@/lib/repo";

export default function QuestionCard({ q, context }: { q: Question; context?: string }) {
  return (
    <article className="finding q">
      <div className="row" style={{ gap: 6 }}>
        <span className="chip cat-mark">질문</span>
        <span className="small muted" style={{ marginLeft: "auto" }}>{context ?? q.screen_id}</span>
      </div>
      <h3>{q.question}</h3>
      {q.status === "open" ? (
        <form action={answerAction} className="row">
          <input type="hidden" name="question_id" value={q.id} />
          <input type="text" name="answer" placeholder="답변 (다음 검수부터 기준으로 써요)" style={{ flex: 1, minWidth: 200 }} required />
          <button className="btn" type="submit">답하기</button>
          <button className="btn" type="submit" formAction={skipQuestionAction} formNoValidate>건너뛰기</button>
        </form>
      ) : q.status === "skipped" ? (
        <p className="small muted" style={{ margin: 0 }}>건너뜀</p>
      ) : (
        <p className="small" style={{ margin: 0 }}><span className="chip done">답변</span> {q.answer}</p>
      )}
    </article>
  );
}
