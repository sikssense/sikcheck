import ExcelJS from "exceljs";
import { CATEGORY_INFO } from "./labels";
import {
  getProject,
  getRound,
  getRoundSummary,
  listFindings,
  listQuestions,
  listRuns,
  MODE_LABEL,
  runLabel,
  VERDICT_LABEL,
  type Finding,
} from "./repo";

const SEVERITY_RANK: Record<string, number> = { 높음: 0, 보통: 1, 낮음: 2 };

// 결과서에 올라가는 항목: 오탐(문제 아님)은 뺀다
export function reportFindings(roundId: string): Finding[] {
  return listFindings(roundId)
    .filter((f) => f.verdict !== "dismissed")
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || a.screen_id.localeCompare(b.screen_id)
    );
}

export const findingId = (roundName: string, i: number) => `${roundName.replace(/\s+/g, "")}-${String(i + 1).padStart(3, "0")}`;

export function judgeLabel(f: Finding): string {
  if (f.judge === "human") return "사람";
  return f.source === "rule" ? "구조 검사" : "AI";
}

const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16181A" } };

function styleSheet(ws: ExcelJS.Worksheet) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = HEAD_FILL;
  head.alignment = { vertical: "middle" };
  head.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.eachRow((r, n) => {
    if (n > 1) r.alignment = { vertical: "top", wrapText: true };
  });
}

const runScreens = (screens: string) => JSON.parse(screens || "[]") as string[];

export async function buildReportXlsx(roundId: string): Promise<{ buffer: ArrayBuffer; filename: string } | null> {
  const round = getRound(roundId);
  const sum = getRoundSummary(roundId);
  if (!round || !sum) return null;
  const project = getProject(round.project_id)!;
  const prev = round.prev_round_id ? getRound(round.prev_round_id) : null;
  const runs = listRuns(roundId).filter((r) => r.status !== "queued");
  const findings = reportFindings(roundId);
  const questions = listQuestions({ roundId });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  const wb = new ExcelJS.Workbook();
  wb.creator = "식스체크 (SikCheck)";
  wb.created = new Date();

  // ① 요약
  const s1 = wb.addWorksheet("요약");
  s1.columns = [{ width: 24 }, { width: 72 }];
  s1.addRow(["항목", "내용"]);
  const rows: [string, string | number][] = [
    ["프로젝트", project.name],
    ["회차", `${round.name} (${MODE_LABEL[round.mode]})`],
    ["이전 버전", prev ? prev.name : "없음 (처음 검수)"],
    ["환경", project.env === "prod" ? "운영 (읽기 전용)" : "개발계"],
    ["기획안", project.figma_links.join("\n") || "-"],
    ["검수 기록", runs.map((r) => runLabel(r, round.mode)).join("\n") || "-"],
    ["작성일", today],
    ["", ""],
    ["결과서 항목", findings.length],
    ["  문제 맞음", sum.confirmed],
    ["  기획 변경", sum.plan_change],
    ["  확인 필요 (미판정)", sum.pending],
    ["제외 (문제 아님)", sum.dismissed],
    ["열린 질문", sum.open_questions],
    ["", ""],
    ...Object.keys(CATEGORY_INFO).map((c) => [`유형 · ${c}`, findings.filter((f) => f.type === c).length] as [string, number]),
    ...["높음", "보통", "낮음"].map((s) => [`심각도 · ${s}`, findings.filter((f) => f.severity === s).length] as [string, number]),
    ["", ""],
    ["AI 비용 (USD)", Number(sum.cost.toFixed(3))],
  ];
  rows.forEach((r) => s1.addRow(r));
  styleSheet(s1);
  s1.addRow([]);
  s1.addRow(["결재", "작성 ____________    검토 ____________    승인 ____________"]).font = { bold: true };

  // ② 결함 목록
  const s2 = wb.addWorksheet("결함 목록");
  s2.columns = [
    { header: "No", width: 6 },
    { header: "ID", width: 12 },
    { header: "화면 ID", width: 28 },
    { header: "유형", width: 10 },
    { header: "심각도", width: 8 },
    { header: "제목", width: 40 },
    { header: "기대 결과 (기획 근거)", width: 44 },
    { header: "실제", width: 44 },
    { header: "근거 인용", width: 44 },
    { header: "판정 주체", width: 10 },
    { header: "AI 확신도", width: 10 },
    { header: "판정", width: 12 },
    { header: "메모", width: 30 },
    { header: "상태", width: 10 },
    { header: "발견일", width: 12 },
  ];
  findings.forEach((f, i) =>
    s2.addRow([
      i + 1,
      findingId(round.name, i),
      f.screen_id,
      f.type,
      f.severity,
      f.title,
      f.expected,
      f.actual,
      f.evidence,
      judgeLabel(f),
      f.confidence === null ? "" : `${Math.round(f.confidence * 100)}%`,
      VERDICT_LABEL[f.verdict] ?? f.verdict,
      f.note,
      f.status,
      f.created_at.slice(0, 10),
    ])
  );
  styleSheet(s2);
  s2.autoFilter = { from: "A1", to: "O1" };

  // ③ 화면별 결과 (기획 검수에서는 화면 단위 결과가 테스트 결과에 해당)
  const screens = new Set<string>();
  runs.forEach((r) => runScreens(r.screens).forEach((s) => screens.add(s)));
  findings.forEach((f) => screens.add(f.screen_id));
  const sortedScreens = [...screens].sort();

  const s3 = wb.addWorksheet(round.mode === "plan" ? "화면별 결과" : "테스트 결과");
  s3.columns = [
    { header: "화면 ID", width: 32 },
    { header: "결과서 항목", width: 12 },
    { header: "높음", width: 8 },
    { header: "확인 필요", width: 10 },
    { header: "결과", width: 14 },
  ];
  sortedScreens.forEach((s) => {
    const list = findings.filter((f) => f.screen_id === s);
    const pending = list.filter((f) => f.verdict === "pending").length;
    s3.addRow([
      s,
      list.length,
      list.filter((f) => f.severity === "높음").length,
      pending,
      list.length === 0 ? "이상 없음" : pending ? "검토 중" : "판정 완료",
    ]);
  });
  styleSheet(s3);

  // ④ 화면 커버리지
  const s4 = wb.addWorksheet("화면 커버리지");
  s4.columns = [
    { header: "화면 ID", width: 32 },
    { header: "검수한 기록", width: 60 },
  ];
  sortedScreens.forEach((s) => {
    const where = runs.filter((r) => runScreens(r.screens).includes(s)).map((r) => runLabel(r, round.mode));
    s4.addRow([s, where.join("\n") || "(섹션 공통 항목)"]);
  });
  styleSheet(s4);

  // ⑤ 변경점: 이전 버전이 연결된 회차만
  if (prev) {
    const s5 = wb.addWorksheet("변경점");
    s5.columns = [
      { header: "화면", width: 32 },
      { header: "판정", width: 50 },
      { header: "심각도", width: 8 },
      { header: "변경 내용", width: 80 },
    ];
    const changes = findings.filter((f) => f.type === "변경");
    if (changes.length === 0) s5.addRow(["", `이전 버전 ${prev.name} 대비 변경 검수 결과가 없어요.`, "", ""]);
    changes.forEach((f) => s5.addRow([f.screen_id, f.title, f.severity, f.evidence]));
    styleSheet(s5);
  }

  // ⑥ 질문·결정 로그
  const s6 = wb.addWorksheet("질문·결정 로그");
  s6.columns = [
    { header: "화면 ID", width: 28 },
    { header: "질문", width: 60 },
    { header: "답", width: 50 },
    { header: "상태", width: 10 },
    { header: "날짜", width: 12 },
  ];
  const Q_STATUS: Record<string, string> = { answered: "답변", skipped: "건너뜀", open: "열림" };
  questions.forEach((q) =>
    s6.addRow([q.screen_id, q.question, q.answer ?? "", Q_STATUS[q.status] ?? q.status, q.created_at.slice(0, 10)])
  );
  styleSheet(s6);

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return { buffer, filename: `${project.name}_${round.name}_${MODE_LABEL[round.mode]}_결과서_${today}.xlsx` };
}
