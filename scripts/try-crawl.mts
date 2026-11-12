import { crawlSite } from "../src/lib/site.ts";
import { readFileSync } from "node:fs";
const base = readFileSync(".env", "utf8").match(/TARGET_BASE_URL=(.*)/)![1].trim();
const snap = await crawlSite({ baseUrl: base, outDir: process.argv[2], maxPages: 20, onProgress: (m) => console.log(m) });
for (const p of snap.pages) console.log("-", p.url, "|", p.texts.length, "texts |", p.texts.slice(0, 6).join(" / ").slice(0, 110), "| console", p.consoleErrors.length);
console.log("blocked", snap.blocked.length, snap.blocked.filter(b => !b.includes("sentry")).slice(0, 5));
