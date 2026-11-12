import Link from "next/link";
import { createProjectAction } from "./actions";
import { ENV_LABEL, listProjects } from "@/lib/repo";

export default function Home() {
  const projects = listProjects();
  return (
    <div className="stack">
      <div className="head">
        <div>
          <h1>홈</h1>
          <p className="sub">프로젝트별로 검수 회차를 쌓아가요.</p>
        </div>
        <Link href="/new" className="btn primary">새 검수 시작</Link>
      </div>

      <section>
        <h2>프로젝트</h2>
        {projects.length === 0 ? (
          <div className="card empty">
            <b>아직 프로젝트가 없어요</b>
            아래에서 만들거나, &lsquo;새 검수 시작&rsquo;에서 바로 만들 수 있어요.
          </div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="card pcard">
                <h3>{p.name}</h3>
                <div className="row small muted">
                  <span className={`chip ${p.env === "prod" ? "prod" : ""}`}>{ENV_LABEL[p.env]}</span>
                  <span>회차 {p.round_count}개</span>
                  <span>기획안 {p.figma_links.length}개</span>
                </div>
                {p.description ? <p className="small muted" style={{ margin: "8px 0 0" }}>{p.description}</p> : null}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>새 프로젝트</h2>
        <form action={createProjectAction} className="f">
          <label className="l">
            이름
            <input type="text" name="name" placeholder="예: 쇼핑몰 FO" required />
          </label>
          <label className="l">
            설명 <span className="h">선택</span>
            <input type="text" name="description" placeholder="예: 영업사원용 모바일 웹" />
          </label>
          <div className="row">
            <button className="btn" type="submit">만들기</button>
          </div>
        </form>
      </section>
    </div>
  );
}
