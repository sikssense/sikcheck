import Link from "next/link";
import { notFound } from "next/navigation";
import { createRoundAction, saveMappingAction, updateSourcesAction } from "@/app/actions";
import { ENV_LABEL, getProject, listMappings, listRounds, MODE_LABEL, type Mode } from "@/lib/repo";

const MODES: Mode[] = ["plan", "impl", "change"];

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  const rounds = listRounds(id);
  const nameById = new Map(rounds.map((r) => [r.id, r.name]));
  const mappings = listMappings(id);

  return (
    <div className="stack">
      <div>
        <div className="crumb"><Link href="/">홈</Link> / 프로젝트</div>
        <h1>{project.name}</h1>
        <p className="sub">{project.description || "회차를 추가하며 계속 검수해요."}</p>
      </div>

      <div className="two">
        <section className="card">
          <div className="head">
            <h2>회차</h2>
            <span className="small muted">{rounds.length}개</span>
          </div>
          {rounds.length === 0 ? (
            <div className="empty"><b>아직 회차가 없어요</b>오른쪽에서 첫 회차를 만들어 보세요.</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>회차</th><th>종류</th><th>이전 버전</th><th>실행</th><th>발견</th><th>생성</th></tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/projects/${id}/rounds/${r.id}`}>{r.name}</Link></td>
                    <td><span className={`chip ${r.mode}`}>{MODE_LABEL[r.mode]}</span></td>
                    <td className="muted">{r.prev_round_id ? nameById.get(r.prev_round_id) ?? "-" : "-"}</td>
                    <td>{r.run_count}</td>
                    <td>{r.finding_count}</td>
                    <td className="muted small">{r.created_at.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <h2>새 회차</h2>
            <form action={createRoundAction} className="f">
              <input type="hidden" name="project_id" value={id} />
              <label className="l">
                이름
                <input type="text" name="name" placeholder="예: 2차" defaultValue={`${rounds.length + 1}차`} required />
              </label>
              <label className="l">
                종류
                <select name="mode" defaultValue="plan">
                  {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </select>
              </label>
              <label className="l">
                이전 버전
                <select name="prev_round_id" defaultValue={rounds[0]?.id ?? ""}>
                  <option value="">없음</option>
                  {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <button className="btn primary" type="submit">회차 만들기</button>
            </form>
          </section>

          <section className="card">
            <h2>검수 대상</h2>
            <form action={updateSourcesAction} className="f">
              <input type="hidden" name="project_id" value={id} />
              <label className="l">
                기획안 링크
                <textarea name="figma_links" defaultValue={project.figma_links.join("\n")} placeholder="Figma 링크, 줄바꿈으로 구분" />
              </label>
              <label className="l">
                사이트
                <input type="url" name="site_url" defaultValue={project.site_url} placeholder="https://" />
              </label>
              <label className="l">
                환경
                <select name="env" defaultValue={project.env}>
                  <option value="dev">{ENV_LABEL.dev}</option>
                  <option value="prod">{ENV_LABEL.prod} · 읽기 전용</option>
                </select>
              </label>
              <button className="btn" type="submit">저장</button>
            </form>
          </section>
        </div>
      </div>
      {mappings.length > 0 ? (
        <section className="card">
          <div className="head">
            <h2>화면 매핑</h2>
            <span className="small muted">구현 검수 때 AI가 짝지은 결과예요. 틀리면 경로를 고치고 저장하면 다음부터 그대로 써요.</span>
          </div>
          <table className="table">
            <thead><tr><th>Figma 화면</th><th>사이트 경로</th><th>근거</th><th></th></tr></thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.screen_key}>
                  <td className="small">{m.screen_key}</td>
                  <td colSpan={3}>
                    <form action={saveMappingAction} className="row" style={{ flexWrap: "nowrap" }}>
                      <input type="hidden" name="project_id" value={id} />
                      <input type="hidden" name="screen_key" value={m.screen_key} />
                      <input type="text" name="url" defaultValue={m.url} placeholder="없음 (예: /rental/awp)" style={{ maxWidth: 260 }} />
                      <span className="small muted" style={{ flex: 1 }}>
                        {m.confirmed ? "사람이 확정" : `AI ${m.confidence !== null ? Math.round(m.confidence * 100) + "% · " : ""}${m.reason}`}
                      </span>
                      <button className="btn" type="submit">{m.confirmed ? "수정" : "확정"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
