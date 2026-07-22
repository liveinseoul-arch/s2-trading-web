import Link from "next/link";
import { eok, pct, signClass } from "@/lib/format";
import { Section, Empty } from "@/components/ui";
import { rs96Perf } from "@/lib/rs96Perf";

export const dynamic = "force-dynamic";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-borderc)] bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-xl font-bold tnum ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export default function Performance() {
  const { meta, yearly, monthly } = rs96Perf;
  const months = [...monthly].reverse();          // 최근월 먼저
  const years = [...yearly].reverse();

  return (
    <>
      <h1 className="mb-3 text-lg font-bold">RS96+ 전략 성과</h1>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="CAGR" value={pct(meta.cagr)} tone={signClass(meta.cagr)} />
        <Stat label="MDD" value={pct(meta.mdd)} tone="text-down" />
        <Stat label="Calmar" value={meta.calmar.toFixed(2)} />
        <Stat label="완결 거래" value={`${meta.nTrades}건`} />
        <Stat label="승률" value={`${meta.winRate.toFixed(1)}%`} />
        <Stat label="매매당 평균" value={pct(meta.avgRet)} tone={signClass(meta.avgRet)} />
      </div>
      <p className="mb-4 text-xs text-muted">
        기준자본 1억 · {meta.start} ~ {meta.end} · 최종 {meta.finalMult.toFixed(2)}배 · 원화 기준.
        구성: {meta.config}. 저승률·고손익비 순정 모멘텀(−8% 손절로 손실 조기 차단 + EMA 트레일로 승자 보유).
        비용·슬리피지 일부 미반영. 자세히는 규칙 화면 참고.
      </p>

      <Section title="연도별 성과" sub="연도를 누르면 그 해 월별·거래 상세. 전략 vs KOSPI·KOSDAQ 비교.">
        {years.length === 0 ? <Empty>데이터 없음</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tnum">
              <thead className="text-xs text-muted">
                <tr className="border-b border-[var(--color-borderc)] text-right">
                  <th className="py-1.5 text-left">연도</th><th>전략</th><th>MDD</th>
                  <th>KOSPI</th><th>KOSDAQ</th><th>거래</th><th>승률</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.year} className="border-b border-[var(--color-borderc)] text-right last:border-0">
                    <td className="py-1.5 text-left font-medium">
                      <Link href={`/performance/y/${y.year}`} className="text-accent">{y.year}</Link>
                    </td>
                    <td className={`font-medium ${signClass(y.ret)}`}>{pct(y.ret)}</td>
                    <td className="text-down">{pct(y.mdd)}</td>
                    <td className={signClass(y.kospi)}>{pct(y.kospi)}</td>
                    <td className={signClass(y.kosdaq)}>{pct(y.kosdaq)}</td>
                    <td>{y.num}</td>
                    <td>{y.win.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="월별 수익률 (%)" sub="월을 누르면 그 달의 상세(청산 거래·보유 현황).">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tnum">
            <thead className="text-xs text-muted">
              <tr className="border-b border-[var(--color-borderc)] text-right">
                <th className="py-1.5 text-left">연도</th>
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i}>{i + 1}월</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...new Set(monthly.map((m) => m.month.slice(0, 4)))].sort().reverse().map((y) => (
                <tr key={y} className="border-b border-[var(--color-borderc)] text-right last:border-0">
                  <td className="py-1.5 text-left font-medium">{y}</td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const key = `${y}-${String(i + 1).padStart(2, "0")}`;
                    const m = monthly.find((x) => x.month === key);
                    return (
                      <td key={i} className={m ? signClass(m.ret) : "text-muted"}>
                        {m ? (
                          <Link href={`/performance/${key}`} className="hover:underline">
                            {pct(m.ret)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="월별 성과" sub="월을 누르면 그 달에 청산된 거래 상세.">
        {months.length === 0 ? <Empty>데이터 없음</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tnum">
              <thead className="text-xs text-muted">
                <tr className="border-b border-[var(--color-borderc)] text-right">
                  <th className="py-1.5 text-left">월</th><th>월수익률</th><th>거래</th><th>보유</th>
                  <th>승률</th><th>평균</th><th>실현손익</th><th>MDD</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className="border-b border-[var(--color-borderc)] text-right last:border-0">
                    <td className="py-1.5 text-left font-medium">
                      <Link href={`/performance/${m.month}`} className="text-accent">{m.month}</Link>
                    </td>
                    <td className={signClass(m.ret)}>{pct(m.ret)}</td>
                    <td>{m.num}</td>
                    <td className="text-muted">{rs96Perf.held[m.month]?.length ?? 0}</td>
                    <td>{m.num > 0 ? `${m.win.toFixed(0)}%` : "-"}</td>
                    <td className={signClass(m.avg)}>{m.num > 0 ? pct(m.avg) : "-"}</td>
                    <td className={signClass(m.pnl)}>{m.num > 0 ? eok(m.pnl) : "-"}</td>
                    <td className="text-down">{pct(m.mdd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p className="text-xs text-muted">
        ※ RS96+ = 상대강도 상위 4% 주도주. 이 성과는 그중 영업이익 급성장(C≥25%)·거래대금 상위20% 종목을
        ATR 리스크 0.7%로 편입해 −8% 손절 + 21/50일 EMA 트레일링으로 운용한 백테스트입니다.
        스크리닝 화면(한국·미국·일본)은 이 전략의 관심종목 출발점입니다.
      </p>
    </>
  );
}
