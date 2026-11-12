import { CATEGORY_INFO } from "@/lib/labels";

export default function Legend() {
  return (
    <details className="legend-box">
      <summary>유형 설명 보기 · 발견은 근거가 있는 문제, 질문은 AI가 판단 근거가 없어 묻는 것</summary>
      <dl>
        {Object.entries(CATEGORY_INFO).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
