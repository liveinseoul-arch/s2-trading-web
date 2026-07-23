import { Section } from "@/components/ui";
import UsBacktestClient from "./Client";

export const revalidate = 3600;

export const metadata = {
  title: "미국 백테스트 (RS96 · 시총20%+EPS배증) — 선두지기",
  description:
    "미국 RS96+ 참고 구성(시총 상위 20% + EPS 배증 게이트, walk-forward 통과)의 백테스트 연도별·월별 수익률. Sharadar 생존편향 보정 데이터, 2002-01~2026-06.",
};

// 백테스트 산출 정적 데이터 — 17_88 엔진, US 유동주 2,911종목(상폐 1,266 포함),
// 시총 상위 20% + EPS 배증 게이트 · ATR 0.7% (미국 한정 참고 구성)
const SUMMARY = [
  { label: "총수익률", value: "+296.5%" },
  { label: "CAGR", value: "+5.8%" },
  { label: "최대 낙폭", value: "−24.1%" },
  { label: "Sharpe", value: "0.57" },
  { label: "거래 수", value: "597건" },
  { label: "S&P500 (동기간)", value: "+7.8% / −56.2%" },
];

export default function JpBacktestPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">미국 백테스트 — RS96 참고 구성 (시총 20% + EPS 배증)</h1>
      <p className="mb-4 text-xs text-muted">
        조건: 주간 RS≥96 진입 · <b>시총 상위 20%</b>(월말 point-in-time) · <b>분기 EPS 배증(C≥100%) 게이트</b>
        (공시일 기준, walk-forward 통과) · M필터 미사용 · ATR 사이징(리스크 0.7%) · −8%/21·50EMA/RS≤87 청산 ·
        손절 후 8주 쿨다운. 데이터: Sharadar 유동주 2,911종목(상폐 1,266 포함, 생존편향 보정), 2002-01-01 ~ 2026-06-30.
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
        절대 수익은 S&P500(+7.8%)에 −2%p 뒤지지만, MDD가 지수의 절반 이하(−24% vs −56%)이고
        위험조정(Sharpe 0.57 vs 0.52)은 상회하는 저낙폭 프로파일이다(무필터 기준선은 4.4%/−47%).
        미국 개별주 RS96은 지수 초과수익이 어려워 &ldquo;참고 구성&rdquo;이며, 상세 검증은 규칙 페이지(/rules/rs96) 참조.
      </p>
    </>
  );
}
