import Link from "next/link";
import { eok, pct, signClass } from "@/lib/format";
import { Section } from "@/components/ui";
import { rs96Perf } from "@/lib/rs96Perf";
import { RsPerfTradeList } from "@/components/RsPerfTradeList";

export const dynamic = "force-dynamic";

export default async function PerfMonth({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;                        // 'YYYY-MM'
  const stat = rs96Perf.monthly.find((m) => m.month === month) ?? null;
  const trades = rs96Perf.trades
    .filter((t) => t.exit.slice(0, 7) === month)
    .sort((a, b) => (a.exit < b.exit ? 1 : a.exit > b.exit ? -1 : b.retPct - a.retPct));

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link href="/performance" className="text-accent">◀ 성과</Link>
        <h1 className="text-lg font-bold">{month} 거래 상세</h1>
      </div>

      {stat && (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          {[
            { k: "월수익률", v: pct(stat.ret), c: signClass(stat.ret) },
            { k: "거래", v: `${stat.num}건` },
            { k: "승률", v: stat.num > 0 ? `${stat.win.toFixed(0)}%` : "-" },
            { k: "매매당 평균", v: stat.num > 0 ? pct(stat.avg) : "-", c: signClass(stat.avg) },
            { k: "실현손익", v: stat.num > 0 ? eok(stat.pnl) : "-", c: signClass(stat.pnl) },
            { k: "MDD", v: pct(stat.mdd), c: "text-down" },
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-[var(--color-borderc)] bg-surface p-2">
              <div className="text-xs text-muted">{s.k}</div>
              <div className={`font-bold tnum ${s.c ?? ""}`}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      <Section title={`${month}에 청산된 거래 ${trades.length}건`}
        sub="RS96+ 진입 → −8% 손절 또는 21/50일 EMA 트레일 이탈로 청산.">
        <RsPerfTradeList trades={trades} />
      </Section>
    </>
  );
}
