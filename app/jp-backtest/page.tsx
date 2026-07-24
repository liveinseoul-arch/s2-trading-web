import { Section } from "@/components/ui";
import JpBacktestClient from "./Client";
import detail from "./detail.json";

export const revalidate = 3600;

export const metadata = {
  title: "일본 백테스트 (RS96 · N225 M필터 gate) — 선두지기",
  description:
    "일본 RS96+ 채택 구성(N225 M필터 gate)의 백테스트 연도별·월별 포트폴리오 수익률. J-Quants 생존편향 보정 데이터, 2017-09~.",
};

// 요약 수치는 detail.json 의 meta 에서 자동 (주간 갱신). 벤치마크만 정적.
const m = (detail as { meta?: { total: number; cagr: number; mdd: number; sharpe: number; nTrades: number; start: string; end: string } }).meta;
const SUMMARY = m
  ? [
      { label: "총수익률", value: `+${m.total}%` },
      { label: "CAGR", value: `+${m.cagr}%` },
      { label: "최대 낙폭", value: `${m.mdd}%`.replace("-", "−") },
      { label: "Sharpe", value: `${m.sharpe}` },
      { label: "거래 수", value: `${m.nTrades}건` },
      { label: "니케이225 (동기간)", value: "+15.5% / −31.8%" },
    ]
  : [];

export default function JpBacktestPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">일본 백테스트 — RS96 채택 구성 (N225 M필터 gate)</h1>
      <p className="mb-4 text-xs text-muted">
        조건: 주간 RS≥96 진입 · <b>니케이225 M필터 gate</b>(분산일·FTD 판정, OFF 주 신규 매수 금지 —
        기간의 37% 차단) · ATR 사이징(리스크 0.7%) · −8%/21·50EMA/RS≤87 청산 · 손절 후 8주 쿨다운 · <b>마진 한도 1.2배</b>.
        데이터: J-Quants 10년(상폐 212종목 포함, 생존편향 보정), 2017-09-01 ~ {m?.end ?? "최근"}.
        최근 구간(스냅샷 이후)은 yfinance 무료 증분으로 매주 전진 — 이 구간은 현존 종목만이라
        신규 상폐 영향이 있을 수 있으나 주 단위로는 극미.
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
