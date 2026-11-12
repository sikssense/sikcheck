// Figma 섹션 구조 확인용 (토큰은 .env에서 읽고 출력하지 않음)
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const [fileKey, nodeId] = process.argv.slice(2);
const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, { headers: { "X-Figma-Token": env.FIGMA_TOKEN } });
console.log("status", res.status);
const json = await res.json();
if (!res.ok) { console.log(json); process.exit(1); }
const root = json.nodes[nodeId].document;
let texts = 0;
const walk = (n, d) => { if (n.type === "TEXT") texts++; if (d <= 1) console.log("  ".repeat(d) + `${n.type} ${n.id} "${n.name}" ${n.absoluteBoundingBox ? Math.round(n.absoluteBoundingBox.width) + "x" + Math.round(n.absoluteBoundingBox.height) : ""}`); (n.children || []).forEach(c => walk(c, d + 1)); };
walk(root, 0);
console.log("total TEXT nodes:", texts, "json bytes:", JSON.stringify(json).length);
