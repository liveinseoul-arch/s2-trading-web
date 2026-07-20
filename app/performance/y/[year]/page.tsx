import Link from "next/link";
import { eok, pct, signClass } from "@/lib/format";
import { Section, Empty } from "@/components/ui";
import { rs96Perf } from "@/lib/rs96Perf";
import { RsPerfTradeList } from "@/components/RsPerfTradeList";

export const dynamic = "force-dynamic";

export default async function PerfYear({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  const y = rs96Perf.yearly.find((r) => String(r.year) === year) ?? null;
  const months = rs96Perf.monthly.filter((m) => m.month.slice(0, 4) === year).reverse();  // 최근 월이 위
  // 그 해 청산된 거래 중 수익률 상위(대박 승자 부각) — 저승률·고손익비 전략 특성.
  const trades = rs96Perf.trades
    .filter((t) => t.exit.slice(0, 4) === year)
    .sort((a, b) => b.retPct - a.retPct);

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link href="/performance" className="text-accent">◀ 성과</Link>
        <h1 className="text-lg font-bold">{year}년 상세</h1>
      </div>

      {y && (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          {[
            { k: "연수익률", v: pct(y.ret), c: signClass(y.ret) },
            { k: "MDD", v: pct(y.mdd), c: "text-down" },
            { k: "KOSPI", v: pct(y.kospi), c: signClass(y.kospi) },
            { k: "KOSDAQ", v: pct(y.kosdaq), c: signClass(y.kosdaq) },
            { k: "거래", v: `${y.num}건` },
            { k: "승률", v: y.num > 0 ? `${y.win.toFixed(0)}%` : "-" },
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-[var(--color-borderc)] bg-surface p-2">
              <div className="text-xs text-muted">{s.k}</div>
              <div className={`font-bold tnum ${s.c ?? ""}`}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      <Section title="월별" sub="월을 누르면 그 달 거래 상세.">
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
                      <Link href={`/performance/${m.month}`} className="text-accent">{m.month.slice(5)}월</Link>
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

      <Section title={`${year}년 청산 거래 ${trades.length}건`} sub="수익률 순 — 저승률·고손익비(소수 대박 승자가 견인).">
        <RsPerfTradeList trades={trades} />
      </Section>
    </>
  );
}
