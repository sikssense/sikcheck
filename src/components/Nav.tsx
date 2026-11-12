"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 아이콘은 1.5px 선 아이콘 (Linear·Lucide 계열)
const I = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  play: <path d="M7 4.5v15l12-7.5z" />,
  inbox: <path d="M3 13h5l1.5 3h5l1.5-3h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />,
  file: <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
};

const ITEMS = [
  { href: "/", label: "홈", icon: I.home },
  { href: "/new", label: "검수 실행", icon: I.play },
  { href: "/review", label: "검토함", icon: I.inbox, count: true },
  { href: "/results", label: "결과", icon: I.file },
  { href: "/settings", label: "설정", icon: I.gear },
];

export default function Nav({ review }: { review: number }) {
  const path = usePathname();
  const isOn = (href: string) => (href === "/" ? path === "/" || path.startsWith("/projects") : path.startsWith(href));
  return (
    <nav className="nav" aria-label="메뉴">
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} className={isOn(it.href) ? "on" : ""}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
            {it.icon}
          </svg>
          <span>{it.label}</span>
          {it.count && review > 0 ? <span className="badge">{review}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
