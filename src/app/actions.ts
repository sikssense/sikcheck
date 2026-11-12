"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createProject,
  createRound,
  createRun,
  getProject,
  parseLinks,
  updateProjectSources,
  getRun,
  getRound,
  setVerdict,
  answerQuestion,
  skipQuestion,
  skipOpenQuestions,
  skipRunQuestions,
  type Env,
  type Mode,
} from "@/lib/repo";
import { checkAllKeys } from "@/lib/keys";
import { setSetting } from "@/lib/settings";
import { MODELS } from "@/lib/ai";
import { runPlanReview } from "@/lib/review/plan";
import { runImplReview } from "@/lib/review/impl";
import { runChangeReview } from "@/lib/review/change";
import { sendChat } from "@/lib/chat";
import { getDb, newId } from "@/lib/db";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

export async function createProjectAction(fd: FormData) {
  const name = str(fd, "name");
  if (!name) return;
  const id = createProject({
    name,
    description: str(fd, "description"),
    site_url: str(fd, "site_url"),
    env: (str(fd, "env") || "dev") as Env,
    figma_links: parseLinks(str(fd, "figma_links")),
  });
  redirect(`/projects/${id}`);
}

export async function updateSourcesAction(fd: FormData) {
  const id = str(fd, "project_id");
  updateProjectSources(id, str(fd, "site_url"), (str(fd, "env") || "dev") as Env, parseLinks(str(fd, "figma_links")));
  revalidatePath(`/projects/${id}`);
}

export async function createRoundAction(fd: FormData) {
  const project_id = str(fd, "project_id");
  const name = str(fd, "name");
  if (!project_id || !name) return;
  const roundId = createRound({
    project_id,
    name,
    mode: (str(fd, "mode") || "plan") as Mode,
    prev_round_id: str(fd, "prev_round_id") || null,
  });
  redirect(`/projects/${project_id}/rounds/${roundId}`);
}

export async function addRunAction(fd: FormData) {
  const roundId = str(fd, "round_id");
  const projectId = str(fd, "project_id");
  createRun(roundId, str(fd, "scope"));
  revalidatePath(`/projects/${projectId}/rounds/${roundId}`);
}

// 검수 실행 위저드: 프로젝트(기존/신규) → 회차 → 첫 실행을 한 번에 만든다
export async function startReviewAction(fd: FormData) {
  let projectId = str(fd, "project_id");
  const links = parseLinks(str(fd, "figma_links"));
  const site = str(fd, "site_url");
  const env = (str(fd, "env") || "dev") as Env;

  if (projectId === "__new") {
    const name = str(fd, "new_project_name");
    if (!name) return;
    projectId = createProject({ name, site_url: site, env, figma_links: links });
  } else {
    const p = getProject(projectId);
    if (!p) return;
    updateProjectSources(projectId, site || p.site_url, env, links.length ? links : p.figma_links);
  }

  const roundId = createRound({
    project_id: projectId,
    name: str(fd, "round_name") || "1차",
    mode: (str(fd, "mode") || "plan") as Mode,
    prev_round_id: str(fd, "prev_round_id") || null,
  });
  createRun(roundId, "전체");
  redirect(`/projects/${projectId}/rounds/${roundId}`);
}

export async function recheckKeysAction() {
  await checkAllKeys();
  revalidatePath("/", "layout");
}

export async function saveFigmaExpiryAction(fd: FormData) {
  const date = str(fd, "expires_on");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) setSetting("figma.expires_on", date);
  revalidatePath("/", "layout");
}

export async function startRunAction(fd: FormData) {
  const runId = str(fd, "run_id");
  const run = getRun(runId);
  if (!run || run.status === "running") return;
  const round = getRound(run.round_id);
  if (!round) return;
  // 결과를 기다리지 않고 백그라운드로 돌린다. 진행 상황은 화면이 주기적으로 다시 읽는다.
  if (round.mode === "plan") void runPlanReview(runId);
  else if (round.mode === "impl") void runImplReview(runId);
  else void runChangeReview(runId);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/projects/${round.project_id}/rounds/${round.id}`);
}

export async function verdictAction(fd: FormData) {
  setVerdict(str(fd, "finding_id"), str(fd, "verdict"), str(fd, "note"));
  revalidatePath("/", "layout");
}

export async function answerAction(fd: FormData) {
  const answer = str(fd, "answer");
  if (!answer) return;
  answerQuestion(str(fd, "question_id"), answer);
  revalidatePath("/", "layout");
}

export async function saveAiSettingsAction(fd: FormData) {
  const model = str(fd, "model");
  if (model in MODELS) setSetting("ai.model", model);
  const budget = Number(str(fd, "budget"));
  if (Number.isFinite(budget) && budget > 0 && budget <= 50) setSetting("ai.budget_usd", String(budget));
  revalidatePath("/settings");
}

export async function skipQuestionAction(fd: FormData) {
  skipQuestion(str(fd, "question_id"));
  revalidatePath("/", "layout");
}

export async function skipAllQuestionsAction(fd: FormData) {
  const runId = str(fd, "run_id");
  if (runId) skipRunQuestions(runId);
  else skipOpenQuestions(str(fd, "round_id"));
  revalidatePath("/", "layout");
}

export async function saveMappingAction(fd: FormData) {
  const projectId = str(fd, "project_id");
  const screen = str(fd, "screen_key");
  let url = str(fd, "url");
  if (url.startsWith("http")) url = new URL(url).pathname + new URL(url).search;
  getDb()
    .prepare(
      `INSERT INTO mappings (id, project_id, screen_key, url, confidence, reason, confirmed) VALUES (?, ?, ?, ?, 1, '사람이 확정', 1)
       ON CONFLICT(project_id, screen_key) DO UPDATE SET url = excluded.url, confirmed = 1, reason = '사람이 확정'`
    )
    .run(newId(), projectId, screen, url);
  revalidatePath(`/projects/${projectId}`);
}

export async function chatAction(fd: FormData) {
  const runId = str(fd, "run_id");
  const text = str(fd, "text");
  if (!runId || !text) return;
  await sendChat(runId, text);
  revalidatePath("/", "layout");
}
