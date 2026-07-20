import { won, pct, signClass, shortName } from "@/lib/format";
import { Empty, MarketBadge } from "@/components/ui";
import { reasonShort, tickerCode, type RsPerfTrade } from "@/lib/rs96Perf";

const mkt = (ticker: string) => (ticker.endsWith(".KQ") ? "KOSDAQ" : "KOSPI");

// RS 전략 거래(단일 진입/청산) 리스트 — 월/연 상세 공용.
export function RsPerfTradeList({ trades }: { trades: RsPerfTrade[] }) {
  if (trades.length === 0) return <Empty>이 기간에 청산된 거래가 없습니다.</Empty>;
  return (
    <ul className="divide-y divide-[var(--color-borderc)]">
      {trades.map((t, i) => (
        <li key={`${t.ticker}-${t.exit}-${i}`} className="flex items-center justify-between py-2">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="font-medium">{shortName(t.name)}</span>
              <span className="text-xs text-muted tnum">{tickerCode(t.ticker)}</span>
              <MarketBadge market={mkt(t.ticker)} />
              <span className="text-xs text-muted">{reasonShort(t.reason)}</span>
            </span>
            <span className="text-xs text-muted tnum">
              {t.entry}~{t.exit} · {t.days}일 · RS {t.rs}{t.ca === "Y" ? " · C통과" : ""}
            </span>
          </span>
          <span className="text-right tnum">
            <span className={`font-medium ${signClass(t.retPct)}`}>{pct(t.retPct)}</span>
            <span className={`block text-xs ${signClass(t.pnl)}`}>
              {t.pnl >= 0 ? "+" : ""}{won(t.pnl)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
