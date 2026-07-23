import { Section } from "@/components/ui";
import JpBacktestClient from "./Client";

export const revalidate = 3600;

export const metadata = {
  title: "일본 백테스트 (RS96 · N225 M필터 gate) — 선두지기",
  description:
    "일본 RS96+ 채택 구성(N225 M필터 gate)의 백테스트 연도별·월별 포트폴리오 수익률. J-Quants 생존편향 보정 데이터, 2017-09~2026-06.",
};

// 백테스트 산출 정적 데이터 — 17_88 엔진, JP 유동주 1,633종목(상폐 212 포함),
// N225 M필터 gate · ATR 사이징 0.7% · 마진 한도 1.3배 (채택 구성)
const SUMMARY = [
  { label: "총수익률", value: "+485.7%" },
  { label: "CAGR", value: "+22.2%" },
  { label: "최대 낙폭", value: "−38.1%" },
  { label: "Sharpe", value: "0.86" },
  { label: "거래 수", value: "847건" },
  { label: "니케이225 (동기간)", value: "+15.5% / −31.8%" },
];

export default function JpBacktestPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">일본 백테스트 — RS96 채택 구성 (N225 M필터 gate)</h1>
      <p className="mb-4 text-xs text-muted">
        조건: 주간 RS≥96 진입 · <b>니케이225 M필터 gate</b>(분산일·FTD 판정, OFF 주 신규 매수 금지 —
        기간의 37% 차단) · ATR 사이징(리스크 0.7%) · −8%/21·50EMA/RS≤87 청산 · 손절 후 8주 쿨다운 · 마진 한도 1.3배.
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
        M필터 없는 기준선은 CAGR 14.4% / MDD −38.7%, 방어형 대안(유동성 상위 10% + 무레버리지)은
        CAGR 10.9% / MDD −18.0%다. 채택 구성(gate)은 약세 구간 방어(2017~21 CAGR 12.4% vs 기준선
        4.9%)에서 우위가 나오는 보험형 프로파일이며, 상세 검증은 규칙 페이지(/rules/rs96) 참조.
      </p>
    </>
  );
}
