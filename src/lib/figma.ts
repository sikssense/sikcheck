import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readEnv } from "./env";

// Figma REST 응답 중 검수에 쓰는 필드만
type FNode = {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  children?: FNode[];
};

export type FigmaText = { text: string; layer: string; x: number; y: number };

export type PlanScreen = {
  key: string; // 예: "AST-REG-01 (NotFound)_PC"
  base: string; // 예: "AST-REG-01"
  state: string; // 예: "NotFound", 기본 화면은 ""
  platform: string; // "PC" | "MO" | ""
  title: string; // 프레임 이름 전체
  frameId: string;
  texts: FigmaText[];
  desc: { frameId: string; texts: FigmaText[] } | null;
  imagePath?: string;
};

export type PlanSnapshot = {
  fileKey: string;
  nodeId: string;
  sectionName: string;
  fetchedAt: string;
  screens: PlanScreen[];
  orphanDescs: { key: string; frameId: string }[];
  others: { name: string; frameId: string }[];
};

export function parseFigmaLink(link: string): { fileKey: string; nodeId: string } | null {
  const m = link.match(/figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const node = new URL(link).searchParams.get("node-id");
  return { fileKey: m[1], nodeId: node ? node.replace(/-/g, ":") : "0:1" };
}

async function figmaGet<T>(pathAndQuery: string): Promise<T> {
  const token = readEnv().FIGMA_TOKEN;
  if (!token) throw new Error("Figma 토큰이 없어요. 설정을 확인해 주세요.");
  const res = await fetch(`https://api.figma.com/v1/${pathAndQuery}`, { headers: { "X-Figma-Token": token } });
  if (res.status === 401 || res.status === 403) throw new Error("Figma 토큰이 만료됐거나 이 파일을 볼 권한이 없어요.");
  if (res.status === 429) throw new Error("Figma 요청 한도에 걸렸어요. 잠시 후 다시 실행해 주세요.");
  if (!res.ok) throw new Error(`Figma 응답 오류 ${res.status}`);
  return (await res.json()) as T;
}

function collectTexts(node: FNode, out: FigmaText[], layer = "") {
  if (node.visible === false) return;
  if (node.type === "TEXT" && node.characters?.trim()) {
    const b = node.absoluteBoundingBox;
    out.push({ text: node.characters.trim(), layer: layer || node.name, x: b?.x ?? 0, y: b?.y ?? 0 });
    return;
  }
  // 바로 위 의미 있는 레이어 이름을 맥락으로 남긴다 (예: "브랜드", "anno/3")
  const nextLayer = node.type === "INSTANCE" || node.type === "COMPONENT" || node.type === "FRAME" ? node.name : layer;
  for (const c of node.children ?? []) collectTexts(c, out, nextLayer);
}

// 읽는 순서: 위→아래, 같은 줄이면 왼쪽→오른쪽
const readingOrder = (a: FigmaText, b: FigmaText) => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x);

const SCREEN_RE = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*(?:\(([^)]+)\))?\s*_(PC|MO)\b/;

function screenKey(name: string): { key: string; base: string; state: string; platform: string } | null {
  const m = name.match(SCREEN_RE);
  if (!m) return null;
  const [, base, state = "", platform] = m;
  return { key: `${base}${state ? ` (${state})` : ""}_${platform}`, base, state, platform };
}

export async function fetchPlanSnapshot(link: string): Promise<PlanSnapshot> {
  const parsed = parseFigmaLink(link);
  if (!parsed) throw new Error(`Figma 링크를 읽지 못했어요: ${link}`);
  const { fileKey, nodeId } = parsed;
  const data = await figmaGet<{ nodes: Record<string, { document: FNode } | null> }>(
    `files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`
  );
  const root = data.nodes[nodeId]?.document;
  if (!root) throw new Error("링크의 노드를 찾지 못했어요. 링크가 맞는지 확인해 주세요.");

  // 섹션/페이지 바로 아래 프레임이 화면 단위. 링크가 화면 하나를 가리키면 그 화면만.
  const frames = root.type === "FRAME" ? [root] : (root.children ?? []).filter((n) => n.type === "FRAME" && n.visible !== false);

  const screens = new Map<string, PlanScreen>();
  const descs = new Map<string, { frameId: string; texts: FigmaText[] }>();
  const others: { name: string; frameId: string }[] = [];

  for (const f of frames) {
    const texts: FigmaText[] = [];
    collectTexts(f, texts);
    texts.sort(readingOrder);
    if (f.name.startsWith("desc_")) {
      const k = screenKey(f.name.slice(5));
      if (k) descs.set(k.key, { frameId: f.id, texts });
      else others.push({ name: f.name, frameId: f.id });
      continue;
    }
    const k = screenKey(f.name);
    if (k) screens.set(k.key, { ...k, title: f.name, frameId: f.id, texts, desc: null });
    else others.push({ name: f.name, frameId: f.id });
  }

  for (const [key, d] of descs) {
    const s = screens.get(key);
    if (s) s.desc = d;
  }
  const orphanDescs = [...descs.entries()].filter(([k]) => !screens.has(k)).map(([key, d]) => ({ key, frameId: d.frameId }));

  return {
    fileKey,
    nodeId,
    sectionName: root.name,
    fetchedAt: new Date().toISOString(),
    screens: [...screens.values()],
    orphanDescs,
    others,
  };
}

// 화면 이미지를 받아 로컬에 저장 (검토함 근거 표시용)
export async function downloadScreenImages(snap: PlanSnapshot, dir: string): Promise<void> {
  if (snap.screens.length === 0) return;
  mkdirSync(dir, { recursive: true });
  const ids = snap.screens.map((s) => s.frameId);
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const res = await figmaGet<{ images: Record<string, string | null> }>(
      `images/${snap.fileKey}?ids=${encodeURIComponent(chunk.join(","))}&format=png&scale=0.5`
    );
    for (const s of snap.screens) {
      const url = res.images[s.frameId];
      if (!url) continue;
      const img = await fetch(url);
      if (!img.ok) continue;
      const file = path.join(dir, `${s.frameId.replace(/:/g, "-")}.png`);
      writeFileSync(file, Buffer.from(await img.arrayBuffer()));
      s.imagePath = file;
    }
  }
}
