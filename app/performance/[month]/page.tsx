import Link from "next/link";
import { eok, won, pct, signClass, shortName } from "@/lib/format";
import { Section, Empty, MarketBadge } from "@/components/ui";
import { rs96Perf, tickerCode } from "@/lib/rs96Perf";
import { RsPerfTradeList } from "@/components/RsPerfTradeList";

export const dynamic = "force-dynamic";

const mkt = (t: string) => (t.endsWith(".KQ") ? "KOSDAQ" : "KOSPI");

export default async function PerfMonth({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;                        // 'YYYY-MM'
  const stat = rs96Perf.monthly.find((m) => m.month === month) ?? null;
  const trades = rs96Perf.trades
    .filter((t) => t.exit.slice(0, 7) === month)
    .sort((a, b) => (a.exit < b.exit ? 1 : a.exit > b.exit ? -1 : b.retPct - a.retPct));
  const held = rs96Perf.held[month] ?? [];
  const isLast = month === rs96Perf.meta.end.slice(0, 7);   // 마지막(최근) 월 = 최근 종가 평가

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

      <div className="grid items-start gap-4 md:grid-cols-2">
      <Section
        title={`월말 보유종목 ${held.length}건`}
        sub={isLast
          ? "최근 거래일 종가 기준. 큰 수치=이번달 평가손익(전월말 대비), 아래=누적(진입가 대비)."
          : "월말 종가 기준. 큰 수치=이번달 평가손익(전월말 대비, 그달 기여), 아래=누적(진입가 대비). 다음 달로 넘어가는 미청산 포지션."}>
        {held.length === 0 ? <Empty>월말 보유 포지션이 없습니다.</Empty> : (
          <ul className="divide-y divide-[var(--color-borderc)]">
            {held.map((h, i) => (
              <li key={`${h.ticker}-${i}`} className="flex items-center justify-between py-2">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">{shortName(h.name)}</span>
                    <span className="text-xs text-muted tnum">{tickerCode(h.ticker)}</span>
                    <MarketBadge market={mkt(h.ticker)} />
                    <span className="text-xs text-muted">RS {h.rs}</span>
                  </span>
                  <span className="text-xs text-muted tnum">
                    {h.entry} 진입 · {won(h.entryPx)}→{won(h.close)}원
                  </span>
                </span>
                <span className="text-right tnum">
                  <span className={`font-medium ${signClass(h.mEvalPct)}`}>{pct(h.mEvalPct)}</span>
                  <span className={`ml-1 text-xs ${signClass(h.mEvalPnl)}`}>
                    ({h.mEvalPnl >= 0 ? "+" : ""}{won(h.mEvalPnl)})
                  </span>
                  <span className="block text-xs text-muted">
                    누적 <span className={signClass(h.evalPct)}>{pct(h.evalPct)}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`${month}에 청산된 거래 ${trades.length}건`}
        sub="RS96+ 진입 → −8% 손절 또는 21/50일 EMA 트레일 이탈로 청산.">
        <RsPerfTradeList trades={trades} />
      </Section>
      </div>
    </>
  );
}
