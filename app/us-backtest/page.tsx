import { Section } from "@/components/ui";
import UsBacktestClient from "./Client";
import detail from "./detail.json";

export const revalidate = 3600;

export const metadata = {
  title: "미국 백테스트 (RS96 · 시총20%+EPS배증) — 선두지기",
  description:
    "미국 RS96+ 참고 구성(시총 상위 20% + EPS 배증 게이트, walk-forward 통과)의 백테스트 연도별·월별 수익률. Sharadar 생존편향 보정 데이터, 최근 10년.",
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
      { label: "S&P500 (동기간)", value: "+13.0% / −31.8%" },
    ]
  : [];

export default function UsBacktestPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">미국 백테스트 — RS96 참고 구성 (시총 20% + EPS 배증)</h1>
      <p className="mb-4 text-xs text-muted">
        조건: 주간 RS≥96 진입 · <b>시총 상위 20%</b>(월말 point-in-time) · <b>분기 EPS 배증(C≥100%) 게이트</b>
        (공시일 기준, walk-forward 통과) · <b>진입 유니버스 4-필터</b>(주가 $5↑ · 주간 거래대금 $200M↑ ·
        상장 52주↑ · 52주 고가 −30% 이내 — 실매매 매수 규칙과 동일) · M필터 미사용 · ATR 사이징(리스크 0.7%) ·
        −8%/21·50EMA/RS≤87 청산 · 손절 후 8주 쿨다운. 데이터: Sharadar 유동주 2,911종목(상폐 포함, 생존편향 보정),
        <b>2016-01-01 ~ {m?.end ?? "최근"}</b>. 최근 구간(스냅샷 이후)은 yfinance 무료 증분으로 매주 전진 —
        이 구간은 현존 종목만이라 신규 상폐 영향이 있을 수 있으나 주 단위로는 극미.
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

      <UsBacktestClient />

      <p className="mt-2 text-xs leading-relaxed text-muted">
        절대 수익은 S&P500(CAGR +13.0%)에 −2.4%p 뒤지지만, MDD가 얕고(−22.0% vs −31.8%)
        위험조정(Sharpe 0.84 vs 0.80)은 상회하는 저낙폭 프로파일이다. 진입 4-필터(실매매 매수 규칙 정합)
        적용 전 기준은 10.9%/−21.9%/0.85로 사실상 동등. 미국 개별주 RS96은 지수 초과수익이 어려워
        &ldquo;참고 구성&rdquo;이며, 상세 검증은 규칙 페이지(/rules/rs96) 참조.
      </p>
    </>
  );
}
