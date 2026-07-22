import { Section } from "@/components/ui";
import JpBacktestClient from "./Client";

export const revalidate = 3600;

export const metadata = {
  title: "일본 백테스트 (RS96 방어형) — 선두지기",
  description:
    "일본 RS96+ 방어형 구성(유동성 상위 10% · 무레버리지)의 백테스트 연도별·월별 포트폴리오 수익률. J-Quants 생존편향 보정 데이터, 2017-09~2026-06.",
};

// 백테스트 산출 정적 데이터 — 17_88 엔진, JP 유동주 1,633종목(상폐 212 포함),
// 유동성 상위 10% 게이트(월말 point-in-time) · MAX_EXPOSURE 1.0(무레버리지) · ATR 사이징 0.7%
const SUMMARY = [
  { label: "총수익률", value: "+149.6%" },
  { label: "CAGR", value: "+10.9%" },
  { label: "최대 낙폭", value: "−18.0%" },
  { label: "Sharpe", value: "0.63" },
  { label: "거래 수", value: "420건" },
  { label: "니케이225 (동기간)", value: "+15.5% / −31.8%" },
];

export default function JpBacktestPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">일본 백테스트 — RS96 방어형 구성</h1>
      <p className="mb-4 text-xs text-muted">
        조건: 주간 RS≥96 진입 · 유동성 상위 10% 게이트(월말 point-in-time) · <b>무레버리지</b> ·
        ATR 사이징(리스크 0.7%) · −8%/21·50EMA/RS≤87 청산 · 손절 후 8주 쿨다운.
        데이터: J-Quants 10년(상폐 212종목 포함, 생존편향 보정), 2017-09-01 ~ 2026-06-30.
        ※ 백테스트이며 수수료·슬리피지 미반영. 자동매매·투자권유 아님.
      </p>

      <Section title="요약">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SUMMARY.map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--color-borderc)] bg-surface p-3">
              <div className="text-xs text-muted">{s.label}</div>
              <div className="text-lg font-bold tnum">{s.value}</div>
            </div>
          ))}
        </div>
      </Section>

      <JpBacktestClient />

      <p className="mt-2 text-xs leading-relaxed text-muted">
        기준선(게이트 없음, 마진 1.3배)은 CAGR 14.4% / MDD −38.7%로 수익은 더 높지만 낙폭이
        두 배다. 이 방어형 구성은 수익 일부를 양보하는 대신 최대 낙폭을 −18%로 억제한
        선택지이며, 상세 검증 과정은 규칙 페이지(/rules/rs96)의 3시장 필터 검증 참조.
      </p>
    </>
  );
}
