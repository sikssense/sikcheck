"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 실행 중일 때만 2초마다 화면을 다시 읽는다
export default function RunPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
