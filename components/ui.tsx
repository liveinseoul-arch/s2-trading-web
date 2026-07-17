import { marketLabel } from "@/lib/format";

// tone: 본문 박스에 위험도 배경/테두리를 입힌다. 미지정 시 기존과 동일(중립).
//   danger  = 진한 주황 (예: 종가가 21·50 EMA 둘 다 이탈)
//   warning = 옅은 주황 (예: 둘 중 하나만 이탈)
// ⚠ 한국식 색관례상 이 앱은 빨강=상승/이익, 파랑=하락/손실. 위험 표시에 빨강을 쓰면
//   정반대로 읽히므로, 상승·하락과 충돌하지 않는 --color-warn(주황, "주의")을 쓴다.
export type SectionTone = "danger" | "warning";

// 주황 배경 위에서는 기본 muted(#868e96, 회색)가 대비 1.9~2.6:1 로 전혀 안 읽힌다
// (배경 투명도를 25%까지 낮춰도 미달 — 회색·주황의 명도가 비슷해서). 그래서 박스 안에서만
// --color-muted 를 진한 갈색으로 덮어쓴다. .text-muted{color:var(--color-muted)} 라 하위에 상속됨.
const TONE_BOX: Record<SectionTone, string> = {
  // 둘 다 이탈 — 주황 40%(#f9d199). muted→#4a3b12 대비 7.4:1, 본문 10.7:1
  danger: "border-warn bg-warn/40 [--color-muted:#4a3b12]",
  // 하나만 이탈 — 절반 강도
  warning: "border-warn/70 bg-warn/20 [--color-muted:#5c4a1a]",
};

export function Section({ title, sub, children, tone, badge }: {
  title: string; sub?: string; children: React.ReactNode;
  tone?: SectionTone; badge?: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold">
        {title}
        {badge}
      </h2>
      {sub && <p className="mb-2 text-xs text-muted">{sub}</p>}
      <div
        className={`rounded-xl border p-3 ${
          tone ? TONE_BOX[tone] : "border-[var(--color-borderc)] bg-surface"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted">{children}</p>;
}

export function MarketBadge({ market }: { market: string }) {
  return (
    <span className="rounded bg-[var(--color-borderc)] px-1.5 py-0.5 text-[11px] text-flat">
      {marketLabel(market)}
    </span>
  );
}

export function Tag({ children, tone = "flat" }: {
  children: React.ReactNode; tone?: "up" | "down" | "flat" | "warn" | "accent";
}) {
  const cls = {
    up: "bg-up-soft text-up", down: "bg-down-soft text-down",
    flat: "bg-[var(--color-borderc)] text-flat", warn: "bg-orange-100 text-warn",
    accent: "bg-cyan-50 text-accent",
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}
