import { supabase } from "@/lib/supabase";
import { won, pct, signClass, shortName, actionLabel } from "@/lib/format";
import { Section, Empty, MarketBadge, Tag } from "@/components/ui";
import type { Trade, TradeLeg } from "@/lib/types";

export const dynamic = "force-dynamic";

// R = 기준 사이징 9%(120일선 아래). 18%(위)면 2R. 포트% 를 R 배수로 환산해 소수1자리로.
const R_PCT = 9;
const toR = (portPct: number) => `${(portPct / R_PCT).toFixed(1)}R`;

export default async function StockDetail({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const { data: tdata } = await supabase.from("trades").select("*")
    .eq("ticker", ticker).order("entry_date", { ascending: false });
  const trades = (tdata as Trade[]) ?? [];
  const ids = trades.map((t) => t.id);
  const { data: ldata } = ids.length
    ? await supabase.from("trade_legs").select("*").in("trade_id", ids).order("d", { ascending: true })
    : { data: [] };
  const legs = (ldata as TradeLeg[]) ?? [];
  const legsByTrade = new Map<number, TradeLeg[]>();
  legs.forEach((l) => legsByTrade.set(l.trade_id, [...(legsByTrade.get(l.trade_id) ?? []), l]));
  const name = trades[0]?.name ?? ticker;

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-bold">{shortName(name)}</h1>
        {trades[0] && <MarketBadge market={trades[0].market} />}
        <span className="text-sm text-muted tnum">{ticker}</span>
      </div>
      {trades.length === 0 ? <Empty>거래 내역 없음</Empty> : trades.map((t) => (
        <Section key={t.id}
          title={`${t.entry_date} ~ ${t.exit_date ?? "보유중"}`}
          sub={`매수 ${t.buy_count}회 · ${t.status === "closed"
            ? `${t.exit_reason} · 보유 ${t.holding_days}일` : "미청산"}`}>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted">투입 {won(t.max_invested)} → 회수 {won(t.proceeds)}</span>
            {t.pnl != null && (
              <span className={`font-bold tnum ${signClass(t.pnl)}`}>
                {t.pnl >= 0 ? "+" : ""}{won(t.pnl)} ({pct(t.ret_pct)})
              </span>
            )}
          </div>
          <ul className="divide-y divide-[var(--color-borderc)]">
            {(legsByTrade.get(t.id) ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="flex items-center gap-1.5">
                  <Tag tone={l.leg_type.startsWith("buy") ? "up" : "down"}>{actionLabel[l.leg_type] ?? l.leg_type}</Tag>
                  <span className="text-xs text-muted tnum">{l.d}</span>
                </span>
                <span className="tnum">
                  {won(l.price)}원 · {l.qty.toLocaleString("ko-KR")}주
                  {l.port_pct != null && (
                    <span className="ml-2 text-xs text-muted" title={`포트 ${l.port_pct.toFixed(1)}% · R=${R_PCT}%`}>
                      {toR(l.port_pct)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}
