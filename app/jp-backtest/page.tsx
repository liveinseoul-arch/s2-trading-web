import { Section } from "@/components/ui";
import { signClass } from "@/lib/format";

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

const YEARLY: { year: number; ret: number; mdd: number }[] = [
  { year: 2017, ret: 3.0, mdd: -5.2 },
  { year: 2018, ret: -9.2, mdd: -14.7 },
  { year: 2019, ret: 7.8, mdd: -5.6 },
  { year: 2020, ret: 4.0, mdd: -10.9 },
  { year: 2021, ret: -8.7, mdd: -17.4 },
  { year: 2022, ret: -1.0, mdd: -10.4 },
  { year: 2023, ret: 6.9, mdd: -13.0 },
  { year: 2024, ret: 22.1, mdd: -9.5 },
  { year: 2025, ret: 26.4, mdd: -15.3 },
  { year: 2026, ret: 59.3, mdd: -17.6 },
];

// 월별 수익률 (%) — 월말 자산 기준
const MONTHLY: Record<string, Record<number, number>> = {
  "2017": { 9: -0.3, 10: 2.5, 11: 6.5, 12: -5.2 },
  "2018": { 1: -0.8, 2: -0.2, 3: -1.0, 4: 0.6, 5: 4.7, 6: 0.1, 7: -2.1, 8: -1.8, 9: 4.3, 10: -5.5, 11: -0.7, 12: -6.6 },
  "2019": { 1: 0.5, 2: -1.9, 3: 0.5, 4: 2.7, 5: -5.6, 6: 1.4, 7: 2.8, 8: 1.2, 9: 3.4, 10: 5.4, 11: -3.3, 12: 0.8 },
  "2020": { 1: 1.1, 2: -6.1, 3: -2.4, 4: 0.6, 5: 9.0, 6: 2.9, 7: -2.0, 8: 1.9, 9: 0.9, 10: -1.8, 11: 0.6, 12: -0.2 },
  "2021": { 1: 1.1, 2: -1.4, 3: -1.6, 4: -0.3, 5: -2.5, 6: -0.5, 7: -4.3, 8: -3.1, 9: 1.8, 10: 0.3, 11: -0.3, 12: 2.1 },
  "2022": { 1: -2.8, 2: 0.6, 3: 13.0, 4: -8.5, 5: 0.2, 6: 0.5, 7: 0.3, 8: 1.5, 9: -4.0, 10: 1.7, 11: 0.5, 12: -2.7 },
  "2023": { 1: -0.7, 2: 0.6, 3: 2.1, 4: -4.1, 5: 2.0, 6: 8.4, 7: 0.5, 8: 0.5, 9: 1.2, 10: -5.2, 11: 4.4, 12: -2.3 },
  "2024": { 1: 0.1, 2: 14.1, 3: 4.7, 4: -8.4, 5: 5.0, 6: 2.6, 7: -3.9, 8: 2.0, 9: 3.6, 10: -3.0, 11: 1.6, 12: 3.4 },
  "2025": { 1: -4.1, 2: -1.8, 3: -0.8, 4: -4.1, 5: 6.6, 6: 6.8, 7: 0.7, 8: 3.9, 9: 5.2, 10: 30.6, 11: -11.2, 12: -3.1 },
  "2026": { 1: 15.2, 2: 35.0, 3: -10.4, 4: -4.6, 5: 22.0, 6: -1.7 },
};

const TH = "px-2 py-1.5 text-right font-medium whitespace-nowrap";
const TD = "px-2 py-1.5 text-right whitespace-nowrap tnum";
const fmt = (n: number | undefined) =>
  n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

export default function JpBacktestPage() {
  const years = Object.keys(MONTHLY).sort();
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

      <Section title="연도별 성과" sub="2017·2026은 부분연도(9월 시작 / 6월까지). MDD는 연중 고점 대비.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-muted">
            <thead>
              <tr className="border-b border-[var(--color-borderc)] text-accent">
                <th className="px-2 py-1.5 text-left font-medium">연도</th>
                <th className={TH}>수익률 (%)</th>
                <th className={TH}>연중 MDD (%)</th>
              </tr>
            </thead>
            <tbody>
              {YEARLY.map((y) => (
                <tr key={y.year} className="border-b border-[var(--color-borderc)] last:border-0">
                  <td className="px-2 py-1.5">{y.year}</td>
                  <td className={`${TD} ${signClass(y.ret)}`}>{fmt(y.ret)}</td>
                  <td className={TD}>{y.mdd.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="월별 수익률 (%)" sub="월말 평가자산 기준.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-muted">
            <thead>
              <tr className="border-b border-[var(--color-borderc)] text-accent">
                <th className="px-2 py-1.5 text-left font-medium">연도</th>
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i} className={TH}>{i + 1}월</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y} className="border-b border-[var(--color-borderc)] last:border-0">
                  <td className="px-2 py-1.5">{y}</td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const v = MONTHLY[y][i + 1];
                    return (
                      <td key={i} className={`${TD} ${v === undefined ? "" : signClass(v)}`}>
                        {fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          기준선(게이트 없음, 마진 1.3배)은 CAGR 14.4% / MDD −38.7%로 수익은 더 높지만 낙폭이
          두 배다. 이 방어형 구성은 수익 일부를 양보하는 대신 최대 낙폭을 −18%로 억제한
          선택지이며, 상세 검증 과정은 규칙 페이지(/rules/rs96)의 3시장 필터 검증 참조.
        </p>
      </Section>
    </>
  );
}
