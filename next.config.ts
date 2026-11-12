import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// 개발 서버(.next)와 배포 빌드(.next-build)가 서로 덮어쓰지 않게 분리
export default function config(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build",
    serverExternalPackages: ["playwright", "exceljs"],
  };
}
