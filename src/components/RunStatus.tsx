"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const PHASES = [
  { id: "read", label: "기획안 읽기" },
  { id: "images", label: "화면 이미지 받기" },
  { id: "review", label: "화면별 검수" },
  { id: "done", label: "정리" },
];

// started_at·finished_at은 서울 시간 "YYYY-MM-DD HH:MM:SS"
const seoul = (t: string) => new Date(t.replace(" ", "T") + "+09:00").getTime();

function elapsed(startedAt: string | null, end: number): string {
  if (!startedAt) return "0초";
  const sec = Math.max(0, Math.floor((end - seoul(startedAt)) / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
}

const END_TITLE: Record<string, string> = {
  done: "검수가 끝났어요",
  stopped: "비용 상한에 도달해 멈췄어요",
  failed: "검수가 실패했어요",
};

export default function RunStatus(props: {
  status: string;
  finishedAt: string | null;
  error: string | null;
  reviewHref: string;
  seq: number;
  scope: string;
  phase: string;
  progress: string;
  done: number;
  total: number;
  screens: string[];
  costUsd: number;
  budgetUsd: number;
  startedAt: string | null;
  findings: number;
  questions: number;
  model: string;
}) {
  const running = props.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const end = running || !props.finishedAt ? now : seoul(props.finishedAt);

  if (!running) {
    return (
      <section className={`runstatus finished ${props.status}`} role="status">
        <div className="rs-top">
          <span className="rs-done" aria-hidden>{props.status === "done" ? "✓" : "!"}</span>
          <div>
            <div className="rs-title">{END_TITLE[props.status] ?? "검수 종료"}</div>
            <div className="small muted">실행 #{props.seq} · {props.scope} · {props.model}</div>
          </div>
        </div>
        {props.error ? <div className="rs-now" style={{ color: "var(--def)" }}>{props.error}</div> : null}
        {props.status === "stopped" ? <div className="rs-now">{props.progress}</div> : null}
        <div className="rs-stats">
          <div><b>{props.total ? `${props.done}/${props.total}` : "-"}</b><span>화면</span></div>
          <div><b>{props.findings}</b><span>발견</span></div>
          <div><b>{props.questions}</b><span>질문</span></div>
          <div><b>${props.costUsd.toFixed(3)}</b><span>비용</span></div>
          <div><b>{elapsed(props.startedAt, end)}</b><span>걸린 시간</span></div>
        </div>
        <div className="row" style={{ justifyContent: "center" }}>
          {props.reviewHref.startsWith("#") ? (
            <a className="btn primary" href={props.reviewHref}>아래에서 판정하기</a>
          ) : (
            <Link className="btn primary" href={props.reviewHref}>결과 보러 가기</Link>
          )}
        </div>
      </section>
    );
  }

  const phaseIdx = Math.max(0, PHASES.findIndex((p) => p.id === props.phase));
  const pct = props.total > 0 ? Math.round((props.done / props.total) * 100) : props.phase === "review" ? 0 : phaseIdx * 10;
  const current = props.screens[props.done];

  return (
    <section className="runstatus" role="status" aria-live="polite">
      <div className="rs-top">
        <span className="spinner" aria-hidden />
        <div>
          <div className="rs-title">검수 중이에요</div>
          <div className="small muted">실행 #{props.seq} · {props.scope} · {props.model}</div>
        </div>
      </div>

      <ol className="rs-phases">
        {PHASES.map((p, i) => (
          <li key={p.id} className={i < phaseIdx ? "done" : i === phaseIdx ? "on" : ""}>
            <i aria-hidden>{i < phaseIdx ? "✓" : ""}</i>
            {p.label}
          </li>
        ))}
      </ol>

      <div className="rs-bar" aria-label={`진행률 ${pct}%`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="rs-now">
        {props.phase === "review" && current ? (
          <>지금 보는 화면 <b>{current}</b></>
        ) : (
          props.progress
        )}
      </div>

      <div className="rs-stats">
        <div><b>{props.total ? `${props.done}/${props.total}` : "-"}</b><span>화면</span></div>
        <div><b>{props.findings}</b><span>발견</span></div>
        <div><b>{props.questions}</b><span>질문</span></div>
        <div><b>${props.costUsd.toFixed(3)}</b><span>비용 (상한 ${props.budgetUsd})</span></div>
        <div><b>{elapsed(props.startedAt, end)}</b><span>경과</span></div>
      </div>

      {props.screens.length > 0 ? (
        <div className="rs-screens">
          {props.screens.map((s, i) => (
            <span key={s} className={i < props.done ? "done" : i === props.done ? "on" : ""}>
              {s}
            </span>
          ))}
        </div>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>다른 메뉴로 이동해도 검수는 계속돼요.</p>
    </section>
  );
}
