// 대상 사이트 로그인 화면 구조 확인 (쓰기 요청 차단, 비밀번호 출력 안 함)
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const env = Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const blocked = [];
await page.route("**/*", (route) => {
  const r = route.request();
  if (r.method() !== "GET" && !/login|auth|token|signin/i.test(r.url())) { blocked.push(`${r.method()} ${r.url()}`); return route.abort(); }
  return route.continue();
});
await page.goto(env.TARGET_BASE_URL + "/login", { waitUntil: "networkidle" });
const inputs = await page.$$eval("input", els => els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder })));
const buttons = await page.$$eval("button", els => els.map(e => e.innerText.trim()).filter(Boolean));
console.log("inputs", inputs); console.log("buttons", buttons);
const reqs = [];
page.on("request", (r) => { if (r.method() !== "GET") reqs.push(`${r.method()} ${r.url().slice(0, 90)}`); });
await page.locator("#userid:visible").first().fill(env.TARGET_TEST_USERNAME);
await page.locator("#password:visible").first().fill(env.TARGET_TEST_PASSWORD);
await page.locator("button:visible", { hasText: "로그인" }).first().click();
await page.waitForLoadState("networkidle");
console.log("non-GET requests on login:", reqs.filter(r => !r.includes("sentry")));
await page.waitForTimeout(1500);
console.log("after login url:", page.url());
const links = await page.$$eval("a[href]", els => [...new Set(els.map(e => e.getAttribute("href")))]);
console.log("links", links.slice(0, 40));
const clickables = await page.$$eval("[role=link],[role=button],button,[onclick],[class*=card],li", els => els.map(e => (e.innerText||"").trim().split(/\n/)[0].slice(0,30)).filter(Boolean).slice(0,40));
await page.screenshot({ path: process.argv[2] });
console.log("clickables", clickables);
console.log("blocked", blocked);
await browser.close();
