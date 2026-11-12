import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";
import { readEnv } from "./env";

export type SitePage = {
  url: string; // 쿼리 포함 경로 (예: /lead/site?type=list)
  pattern: string; // 상세 id를 묶은 경로 (예: /lead/site/detail/{id})
  title: string;
  texts: string[]; // 화면에 보이는 텍스트 (읽는 순서, 중복 제거)
  consoleErrors: string[];
  screenshot?: string;
  viewport: "PC" | "MO";
};

export type SiteSnapshot = { baseUrl: string; fetchedAt: string; pages: SitePage[]; blocked: string[] };

// 눌러도 되는지: 데이터를 만들거나 바꾸는 말이 들어간 버튼은 절대 누르지 않는다
const UNSAFE = /(삭제|저장|신청|제출|등록|취소|발송|전송|보내기|로그아웃|탈퇴|결제|구매|확정|승인|반려|수정|변경|초기화|업로드|제보|해제|추가하기|신고)/;

export const patternOf = (u: string) =>
  u
    .split("?")[0]
    .replace(/\/\d+(?=\/|$)/g, "/{id}")
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, "/{id}");

async function newContext(browser: Browser, viewport: "PC" | "MO", blocked: string[]): Promise<BrowserContext> {
  const ctx =
    viewport === "MO"
      ? await browser.newContext({ ...devices["iPhone 13"], locale: "ko-KR" })
      : await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  return ctx;
}

// 로그인 뒤에는 GET 외의 모든 요청을 막는다 (안전 모드)
async function guard(ctx: BrowserContext, state: { loggedIn: boolean }, blocked: string[]) {
  await ctx.route("**/*", (route) => {
    const r = route.request();
    if (state.loggedIn && r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS") {
      if (blocked.length < 200) blocked.push(`${r.method()} ${r.url().slice(0, 120)}`);
      return route.abort();
    }
    return route.continue();
  });
}

async function login(page: Page, base: string) {
  const env = readEnv();
  if (!env.TARGET_TEST_USERNAME || !env.TARGET_TEST_PASSWORD) throw new Error(".env에 테스트 계정이 없어요.");
  await page.goto(`${base}/login`, { waitUntil: "networkidle", timeout: 30000 });
  const id = page
    .locator("#userid:visible, input[name*=id i]:visible, input:visible:not([type=password]):not([type=hidden]):not([type=checkbox])")
    .first();
  await id.fill(env.TARGET_TEST_USERNAME);
  await page.locator("input[type=password]:visible").first().fill(env.TARGET_TEST_PASSWORD);
  await page.locator("button:visible", { hasText: "로그인" }).first().click();
  // 로그인 뒤 이동이 늦게 일어나는 경우가 있어 주소가 바뀔 때까지 기다린다
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("개발계 로그인에 실패했어요. .env의 테스트 계정을 확인해 주세요.");
}

async function readPage(page: Page): Promise<{ title: string; texts: string[] }> {
  return page.evaluate(() => {
    const out: { t: string; y: number; x: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el) continue;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({ t, y: r.top + window.scrollY, x: r.left });
    }
    // 입력칸 placeholder와 값도 화면 요소로 본다
    document.querySelectorAll("input,textarea").forEach((e) => {
      const i = e as HTMLInputElement;
      const r = i.getBoundingClientRect();
      if (r.width === 0) return;
      if (i.placeholder) out.push({ t: `[입력칸] ${i.placeholder}`, y: r.top + window.scrollY, x: r.left });
    });
    out.sort((a, b) => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x));
    const seen = new Set<string>();
    const texts = out.map((o) => o.t).filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
    return { title: document.title, texts: texts.slice(0, 400) };
  });
}

async function gotoSoft(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// Next.js가 링크를 미리 불러오는 요청(?_rsc=)과 페이지 조각 파일에서 경로를 뽑는다
function routeFromRequest(u: string, origin: string): string | null {
  if (!u.startsWith(origin)) return null;
  const url = new URL(u);
  // 경로 틀([id] 같은 동적 구간)은 실제로 열 수 없으니 뺀다
  if (url.searchParams.has("_rsc")) return decodeURIComponent(url.pathname).includes("[") ? null : url.pathname;
  const m = url.pathname.match(/\/_next\/static\/chunks\/app\/(.+?)\/page-[^/]+\.js$/);
  if (m) {
    const route = "/" + m[1].split("/").filter((seg) => !/^\(.*\)$/.test(seg)).join("/");
    return route.includes("[") ? null : route;
  }
  return null;
}

// 같은 사이트 안에서 눌러서 이동할 수 있는 후보를 찾는다 (링크 + 클릭 가능한 짧은 문구)
async function discover(page: Page, base: string): Promise<string[]> {
  const origin = new URL(base).origin;
  const hrefs = await page.$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href));
  const found = new Set(hrefs.filter((h) => h.startsWith(origin)).map((h) => h.slice(origin.length) || "/"));

  // 클릭 가능한 요소에 번호를 붙인다. 글자 없는 아이콘 버튼(마이페이지 등)도 포함.
  const count = await page.evaluate((unsafe) => {
    const re = new RegExp(unsafe);
    document.querySelectorAll("[data-sc-idx]").forEach((e) => e.removeAttribute("data-sc-idx"));
    const els = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((e) => {
      const st = getComputedStyle(e);
      if (st.cursor !== "pointer" || e.closest("a[href]")) return false;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const t = (e.innerText || e.getAttribute("aria-label") || e.getAttribute("title") || "").trim();
      const icon = !t && !!e.querySelector("svg,img");
      return (icon || (t.length > 0 && t.length <= 24)) && !re.test(t);
    });
    const outer = els.filter((e) => !els.some((p) => p !== e && p.contains(e)));
    outer.slice(0, 20).forEach((e, i) => e.setAttribute("data-sc-idx", String(i)));
    return Math.min(outer.length, 20);
  }, UNSAFE.source);

  const start = page.url();
  for (let i = 0; i < count; i++) {
    try {
      const el = page.locator(`[data-sc-idx="${i}"]`);
      if ((await el.count()) === 0) continue;
      await el.first().click({ timeout: 2000 });
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      const now = page.url();
      if (now !== start && now.startsWith(origin)) found.add(now.slice(origin.length) || "/");
      if (now !== start) {
        await gotoSoft(page, start);
        // 다시 들어오면 번호가 사라지므로 다시 붙인다
        await page.evaluate((unsafe) => {
          const re = new RegExp(unsafe);
          const els = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((e) => {
            const st = getComputedStyle(e);
            if (st.cursor !== "pointer" || e.closest("a[href]")) return false;
            const r = e.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            const t = (e.innerText || e.getAttribute("aria-label") || e.getAttribute("title") || "").trim();
            const icon = !t && !!e.querySelector("svg,img");
            return (icon || (t.length > 0 && t.length <= 24)) && !re.test(t);
          });
          const outer = els.filter((e) => !els.some((p) => p !== e && p.contains(e)));
          outer.slice(0, 20).forEach((e, j) => e.setAttribute("data-sc-idx", String(j)));
        }, UNSAFE.source);
      } else {
        await page.keyboard.press("Escape").catch(() => {});
      }
    } catch {
      // 누를 수 없는 요소는 건너뜀
    }
  }
  return [...found];
}

export async function crawlSite(opts: {
  baseUrl: string;
  outDir: string;
  maxPages?: number;
  extraPaths?: string[];
  onProgress?: (msg: string) => void;
}): Promise<SiteSnapshot> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const maxPages = opts.maxPages ?? 25;
  mkdirSync(opts.outDir, { recursive: true });
  const blocked: string[] = [];
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser, "PC", blocked);
    const state = { loggedIn: false };
    await guard(ctx, state, blocked);
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    const origin = new URL(base).origin;
    const prefetched = new Set<string>();
    page.on("request", (r) => {
      const route = routeFromRequest(r.url(), origin);
      if (route) prefetched.add(route);
    });
    opts.onProgress?.("개발계 로그인 중");
    await login(page, base);
    state.loggedIn = true;

    const queue = ["/", ...(opts.extraPaths ?? [])];
    const seenPattern = new Set<string>();
    const pages: SitePage[] = [];
    while (queue.length && pages.length < maxPages) {
      const p = queue.shift()!;
      const pat = patternOf(p);
      if (seenPattern.has(pat) || pat.startsWith("/login")) continue;
      seenPattern.add(pat);
      opts.onProgress?.(`사이트 읽는 중 ${pages.length + 1}/${maxPages} · ${p}`);
      consoleErrors.length = 0;
      try {
        await gotoSoft(page, base + p);
      } catch {
        continue;
      }
      if (new URL(page.url()).pathname.startsWith("/login")) continue;
      const { title, texts } = await readPage(page);
      const shot = path.join(opts.outDir, `pc_${pages.length}.png`);
      await page.screenshot({ path: shot, fullPage: true, clip: undefined }).catch(() => {});
      pages.push({ url: p, pattern: pat, title, texts, consoleErrors: [...new Set(consoleErrors)], screenshot: shot, viewport: "PC" });
      const next = await discover(page, base);
      for (const n of [...next, ...prefetched]) if (!seenPattern.has(patternOf(n)) && !queue.includes(n)) queue.push(n);
    }
    await ctx.close();
    return { baseUrl: base, fetchedAt: new Date().toISOString(), pages, blocked };
  } finally {
    await browser.close();
  }
}

// 모바일 화면: 같은 경로를 모바일 기기로 다시 읽는다
export async function capturePages(opts: {
  baseUrl: string;
  outDir: string;
  paths: string[];
  viewport: "PC" | "MO";
}): Promise<SitePage[]> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const blocked: string[] = [];
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser, opts.viewport, blocked);
    const state = { loggedIn: false };
    await guard(ctx, state, blocked);
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    await login(page, base);
    state.loggedIn = true;
    const out: SitePage[] = [];
    for (const [i, p] of opts.paths.entries()) {
      consoleErrors.length = 0;
      try {
        await gotoSoft(page, base + p);
      } catch {
        continue;
      }
      const { title, texts } = await readPage(page);
      const shot = path.join(opts.outDir, `${opts.viewport.toLowerCase()}_x${i}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      out.push({ url: p, pattern: patternOf(p), title, texts, consoleErrors: [...new Set(consoleErrors)], screenshot: shot, viewport: opts.viewport });
    }
    await ctx.close();
    return out;
  } finally {
    await browser.close();
  }
}
