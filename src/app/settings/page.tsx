import { recheckKeysAction, saveAiSettingsAction, saveFigmaExpiryAction } from "../actions";
import { budgetUsd, currentModel, MODELS } from "@/lib/ai";
import { figmaExpiry, KEY_STATE_LABEL, lastChecks, type KeyCheck } from "@/lib/keys";

function StatusRow({ check }: { check: KeyCheck | null }) {
  if (!check) return <p className="muted small">아직 확인하지 않았어요. 아래 &lsquo;지금 확인&rsquo;을 눌러주세요.</p>;
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <span className={`chip ${check.state === "ok" ? "done" : "prod"}`}>{KEY_STATE_LABEL[check.state]}</span>
      <div>
        <div>{check.detail}</div>
        <div className="small muted">마지막 확인 {check.checked_at}</div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const checks = lastChecks();
  const expiry = figmaExpiry();
  const expiryText =
    expiry.daysLeft === null
      ? "만료일을 기록하지 않았어요"
      : expiry.daysLeft < 0
        ? `${-expiry.daysLeft}일 전에 만료됐어요`
        : expiry.daysLeft === 0
          ? "오늘 만료돼요"
          : `${expiry.daysLeft}일 남았어요`;

  const model = currentModel();
  const budget = budgetUsd();
  return (
    <div className="stack">
      <div className="head">
        <div>
          <h1>설정</h1>
          <p className="sub">키 상태와 만료일을 확인해요. 키 값 자체는 <code>.env</code> 파일에만 있고 여기엔 표시하지 않아요.</p>
        </div>
        <form action={recheckKeysAction}>
          <button className="btn primary" type="submit">지금 확인</button>
        </form>
      </div>

      <div className="two">
        <section className="card stack" style={{ gap: 14 }}>
          <h2 style={{ margin: 0 }}>Figma 토큰</h2>
          <StatusRow check={checks.figma} />
          <dl className="kv">
            <dt>만료일</dt>
            <dd>
              {expiry.date ?? "-"}{" "}
              <span className={expiry.daysLeft !== null && expiry.daysLeft <= 7 ? "" : "muted"}>({expiryText})</span>
            </dd>
          </dl>
          <form action={saveFigmaExpiryAction} className="row">
            <input type="date" name="expires_on" defaultValue={expiry.date ?? ""} style={{ maxWidth: 200 }} />
            <button className="btn" type="submit">만료일 저장</button>
          </form>
          <p className="small muted" style={{ margin: 0 }}>
            Figma는 토큰 만료일을 API로 알려주지 않아서, 발급할 때 고른 만료일을 여기 기록해 두면 7일 전부터 상단에 알려드려요.
            만료되면 figma.com → Settings → Security → Personal access tokens에서 새로 발급해 <code>.env</code>의 FIGMA_TOKEN만 바꾸면 돼요.
          </p>
        </section>

        <section className="card stack" style={{ gap: 14 }}>
          <h2 style={{ margin: 0 }}>Anthropic API 키</h2>
          <StatusRow check={checks.anthropic} />
          <dl className="kv">
            <dt>만료</dt>
            <dd>없음 (직접 삭제하기 전까지 유지)</dd>
            <dt>잔액</dt>
            <dd>
              <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                콘솔 Billing에서 확인
              </a>
            </dd>
          </dl>
          <p className="small muted" style={{ margin: 0 }}>
            잔액은 API로 조회할 수 없어요. 잔액이 부족하면 검수 실행 시 바로 알려드리고 멈춰요. 콘솔에서 자동 충전을 켜두면 편해요.
          </p>
        </section>
      </div>

      <section className="card stack" style={{ gap: 14 }}>
        <h2 style={{ margin: 0 }}>AI 모델과 비용 상한</h2>
        <form action={saveAiSettingsAction} className="f">
          <div className="radios">
            {(Object.keys(MODELS) as (keyof typeof MODELS)[]).map((id) => (
              <label key={id} className="radio">
                <input type="radio" name="model" value={id} defaultChecked={id === model} />
                <span>
                  <b>{MODELS[id].label}</b>
                  <span className="small muted">입력 ${MODELS[id].input} · 출력 ${MODELS[id].output} / 100만 토큰</span>
                </span>
              </label>
            ))}
          </div>
          <label className="l">
            실행 1번당 비용 상한 (달러) <span className="h">넘으면 그 자리에서 멈추고 그때까지 결과는 저장해요</span>
            <input type="text" name="budget" defaultValue={String(budget)} style={{ maxWidth: 140 }} />
          </label>
          <div><button className="btn" type="submit">저장</button></div>
        </form>
      </section>
    </div>
  );
}
