import { startReviewAction } from "../actions";
import { listProjects, listRounds, MODE_DESC, MODE_LABEL, type Mode } from "@/lib/repo";

const MODES: Mode[] = ["plan", "impl", "change"];

export default function NewReview() {
  const projects = listProjects();
  const roundsByProject = projects.map((p) => ({ project: p, rounds: listRounds(p.id) }));
  const hasRounds = roundsByProject.some((x) => x.rounds.length > 0);

  return (
    <div className="stack">
      <div>
        <h1>검수 실행</h1>
        <p className="sub">순서대로 채우면 회차가 만들어지고 첫 실행이 대기열에 올라가요.</p>
      </div>

      <form action={startReviewAction} className="card f" style={{ gap: 22 }}>
        <div className="step">
          <b>1</b>
          <div className="f">
            <label className="l">
              프로젝트
              <select name="project_id" defaultValue={projects[0]?.id ?? "__new"}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="__new">+ 새 프로젝트</option>
              </select>
            </label>
            <label className="l">
              새 프로젝트 이름 <span className="h">&lsquo;+ 새 프로젝트&rsquo;를 골랐을 때만</span>
              <input type="text" name="new_project_name" placeholder="예: 쇼핑몰 FO" />
            </label>
          </div>
        </div>

        <div className="step">
          <b>2</b>
          <div className="f">
            <span className="l" style={{ marginBottom: -6 }}>검수 종류</span>
            <div className="radios">
              {MODES.map((m) => (
                <label key={m} className="radio">
                  <input type="radio" name="mode" value={m} defaultChecked={m === "plan"} />
                  <span><b>{MODE_LABEL[m]}</b><span className="small muted">{MODE_DESC[m]}</span></span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="step">
          <b>3</b>
          <div className="f">
            <label className="l">
              회차 이름
              <input type="text" name="round_name" placeholder="예: 1차, 고도화 1" defaultValue="1차" />
            </label>
            <label className="l">
              이전 버전 <span className="h">이 회차가 어떤 회차의 다음 버전인지. 처음이면 비워두세요</span>
              <select name="prev_round_id" defaultValue="">
                <option value="">없음 (처음 검수)</option>
                {hasRounds
                  ? roundsByProject.map(({ project, rounds }) =>
                      rounds.length ? (
                        <optgroup key={project.id} label={project.name}>
                          {rounds.map((r) => (
                            <option key={r.id} value={r.id}>{r.name} · {MODE_LABEL[r.mode]} · {r.created_at.slice(0, 10)}</option>
                          ))}
                        </optgroup>
                      ) : null
                    )
                  : null}
              </select>
            </label>
          </div>
        </div>

        <div className="step">
          <b>4</b>
          <div className="f">
            <label className="l">
              기획안 링크 <span className="h">Figma 페이지·섹션 링크. 여러 개면 줄바꿈으로 구분</span>
              <textarea name="figma_links" placeholder="https://www.figma.com/design/...?node-id=..." />
            </label>
            <label className="l">
              검수할 사이트 <span className="h">기획 검수만 할 때는 비워도 돼요</span>
              <input type="url" name="site_url" placeholder="https://dev.example.com" />
            </label>
            <label className="l">
              환경
              <select name="env" defaultValue="dev">
                <option value="dev">개발계 · 모든 동작 검수</option>
                <option value="prod">운영 · 읽기 동작만 (안전 모드 강제)</option>
              </select>
            </label>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn primary" type="submit">회차 만들고 실행 대기</button>
        </div>
      </form>
    </div>
  );
}
