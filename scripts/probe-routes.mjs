import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const env = Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(env.TARGET_BASE_URL + "/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const info = await page.evaluate(async () => {
  const w = window;
  const bm = w.__BUILD_MANIFEST;
  return { hasBuildManifest: !!bm, sortedPages: bm?.sortedPages ?? null, nextData: !!w.__NEXT_DATA__, appRouter: !!document.querySelector("script[src*='/app/']") };
});
console.log(JSON.stringify(info, null, 1).slice(0, 3000));
await browser.close();
