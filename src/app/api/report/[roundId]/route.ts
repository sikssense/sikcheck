import { buildReportXlsx } from "@/lib/report";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const out = await buildReportXlsx(roundId);
  if (!out) return new Response("회차를 찾지 못했어요", { status: 404 });
  return new Response(out.buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
    },
  });
}
