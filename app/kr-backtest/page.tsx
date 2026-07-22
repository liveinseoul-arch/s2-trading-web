import { Section } from "@/components/ui";
import KrBacktestClient from "./Client";

export const revalidate = 3600;

export const metadata = {
  title: "한국 백테스트 (RS96 프로덕션) — 선두지기",
  description:
    "한국 RS96+ 프로덕션 규칙의 백테스트 연도별·월별 포트폴리오 수익률. 상장폐지 보정 데이터, 2017-01~2026-06.",
};

// 백테스트 산출 정적 데이터 — 17_88 엔진, JP 유동주 1,633종목(상폐 212 포함),
// 유동성 상위 10% 게이트(월말 point-in-time) · MAX_EXPOSURE 1.0(무레버리지) · ATR 사이징 0.7%
const SUMMARY = [
  { label: "총수익률", value: "+259.6%" },
  { label: "CAGR", value: "+14.5%" },
  { label: "최대 낙폭", value: "−47.4%" },
  { label: "Sharpe", value: "0.49" },
  { label: "거래 수", value: "865건" },
  { label: "KOSPI (동기간)", value: "+16.2% / −42.9%" },
];

export default function JpBacktestPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">한국 백테스트 — RS96 프로덕션 규칙</h1>
      <p className="mb-4 text-xs text-muted">
        조건: 주간 RS≥96 진입 + 시장 M필터 ON · 시총 상위 40% · ATR 사이징(리스크 0.7%) ·
        −8%/21·50EMA/RS≤87 청산 · 손절 후 8주 쿨다운 · 마진 한도 1.3배 · 재무 게이트 없음.
        데이터: 상장폐지 보정 표준 캐시, 2017-01-01 ~ 2026-06-30.
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

      <KrBacktestClient />

      <p className="mt-2 text-xs leading-relaxed text-muted">
        영업이익 배증 게이트(walk-forward 통과) 적용 시 CAGR 14.0% / MDD −21.1% / Sharpe 0.72로
        낙폭을 절반 이하로 줄이는 선택지가 있다. 상세 검증 과정은 규칙 페이지(/rules/rs96)의
        3시장 필터 검증 참조. ※ 백테스트, 수수료·거래세 미반영.
      </p>
    </>
  );
}
