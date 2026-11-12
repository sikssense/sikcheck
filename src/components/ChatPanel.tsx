import { chatAction } from "@/app/actions";
import { listChat } from "@/lib/chat";
import SubmitButton from "./SubmitButton";

const EXAMPLES = ["용어 지적은 전부 문제 아님으로 처리해줘", "AWP 화면만 다시 검수해줘", "견적과 렌탈료는 같은 말로 써도 돼"];

export default function ChatPanel({ runId }: { runId: string }) {
  const messages = listChat(runId);
  return (
    <section className="chat">
      <div className="chat-h">
        <h2 style={{ margin: 0 }}>대화로 검수하기</h2>
        <span className="small muted">판정·답변·규칙·재검수를 말로 지시해요</span>
      </div>
      {messages.length > 0 ? (
        <div className="chat-log">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="msg-who">{m.role === "user" ? "나" : "식스체크"}</div>
              <div className="msg-body">
                {m.content}
                {m.actions ? <div className="msg-actions">{m.actions}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="chat-examples small muted">예: {EXAMPLES.map((e) => `“${e}”`).join(" · ")}</div>
      )}
      <form action={chatAction} className="row chat-form">
        <input type="hidden" name="run_id" value={runId} />
        <input type="text" name="text" placeholder="이 검수 결과에 대해 말해 주세요" required style={{ flex: 1, minWidth: 220 }} />
        <SubmitButton label="보내기" pendingLabel="처리 중" />
      </form>
    </section>
  );
}
