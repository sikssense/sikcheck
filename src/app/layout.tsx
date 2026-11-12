import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { countOpen, listProjects } from "@/lib/repo";
import { keyAlerts } from "@/lib/keys";
import "./globals.css";

export const metadata: Metadata = {
  title: "식스체크",
  description: "Figma 기획을 정답지로 사이트와 기획서를 검수해요",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const projects = listProjects();
  const open = countOpen();
  const alerts = keyAlerts();
  return (
    <html lang="ko">
      <body>
        <div className="shell">
          <aside className="side">
            <Link href="/" className="brand"><i aria-hidden />식스체크<span className="brand-en">SikCheck</span></Link>
            <Nav review={open.findings + open.questions} />
            <div>
              <div className="side-h">프로젝트</div>
              <div className="folders">
                {projects.length === 0 ? (
                  <span className="muted small" style={{ padding: "0 10px" }}>아직 없어요</span>
                ) : (
                  projects.map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}`}>{p.name}</Link>
                  ))
                )}
              </div>
            </div>
            <div className="side-foot">워크스페이스 · 개인<br />로컬 실행 중</div>
          </aside>
          <main className="main">
            {alerts.length > 0 ? (
              <Link href="/settings" className="alert">
                {alerts.map((a) => <span key={a}>{a}</span>)}
                <b>설정에서 확인 →</b>
              </Link>
            ) : null}
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
