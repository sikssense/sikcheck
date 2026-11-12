import { verdictAction } from "@/app/actions";
import { VERDICT_LABEL, type Finding } from "@/lib/repo";
import { CATEGORY_INFO, VERDICT_INFO } from "@/lib/labels";

const CAT_CLASS: Record<string, string> = {
  불일치: "mis",
  누락: "def",
  충돌: "def",
  용어: "chg",
  오탈자: "chg",
  "확인 필요": "mark",
  제안: "sug",
  결함: "def",
  변경: "chg",
};

export default function FindingCard({ f, context }: { f: Finding; context?: string }) {
  return (
    <article className={`finding sev-${f.severity}`}>
      <div className="row" style={{ gap: 6 }}>
        <span className={`chip cat-${CAT_CLASS[f.type] ?? ""}`} title={CATEGORY_INFO[f.type]}>{f.type}</span>
        <span className={`chip sev-${f.severity}`}>{f.severity}</span>
        {f.source === "rule" ? <span className="chip">구조 검사</span> : null}
        {f.confidence !== null && f.source !== "rule" ? <span className="small muted">확신 {Math.round(f.confidence * 100)}%</span> : null}
        <span className="small muted" style={{ marginLeft: "auto" }}>{context ?? f.screen_id}</span>
      </div>
      <h3>{f.title}</h3>
      <dl className="kv">
        <dt>기대</dt>
        <dd>{f.expected || "-"}</dd>
        <dt>실제</dt>
        <dd>{f.actual || "-"}</dd>
        <dt>근거</dt>
        <dd className="quote">{f.evidence || "-"}</dd>
      </dl>
      {f.verdict === "pending" ? (
        <form action={verdictAction} className="row verdicts">
          <input type="hidden" name="finding_id" value={f.id} />
          <input type="text" name="note" placeholder="메모 (선택)" style={{ flex: 1, minWidth: 160 }} />
          <button className="btn" name="verdict" value="confirmed" title={VERDICT_INFO.confirmed}>문제 맞음</button>
          <button className="btn" name="verdict" value="plan_change" title={VERDICT_INFO.plan_change}>기획 변경</button>
          <button className="btn" name="verdict" value="dismissed" title={VERDICT_INFO.dismissed}>문제 아님</button>
        </form>
      ) : (
        <div className="small">
          <span className={`chip ${f.verdict === "dismissed" ? "" : "done"}`}>{VERDICT_LABEL[f.verdict] ?? f.verdict}</span>
          {f.note ? <span className="muted"> · {f.note}</span> : null}
        </div>
      )}
    </article>
  );
}
