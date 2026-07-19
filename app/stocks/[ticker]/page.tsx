import { supabase } from "@/lib/supabase";
import { won, pct, signClass, shortName, actionLabel } from "@/lib/format";
import { Section, Empty, MarketBadge, Tag } from "@/components/ui";
import type { Trade, TradeLeg } from "@/lib/types";

export const dynamic = "force-dynamic";

// R = 그 거래의 신규매수(buy_new) 금액 = 1R. 각 회차 금액을 R 배수로(소수1자리).
// 신규매수 금액 기준이라 매수 R 합 = 매도 R 합이 맞아떨어짐(port_pct 는 그날 NAV 대비라 불일치).
function rOf(amount: number | null, baseAmt: number): string | null {
  if (amount == null || baseAmt <= 0) return null;
  return `${(amount / baseAmt).toFixed(1)}R`;
}

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
  // 같은 날 여러 leg(예: 갭업에 1·2차매도 동시 09:01)의 표시 순서 — 논리적 매매 순서로 정렬.
  const LEG_ORDER: Record<string, number> = {
    buy_new: 0, buy_add: 1, sell_1: 2, sell_2: 3, sell_3: 4, stop: 5, newlow_stop: 6,
  };
  const sortLegs = (arr: TradeLeg[]) =>
    [...arr].sort((a, b) =>
      a.d < b.d ? -1 : a.d > b.d ? 1
        : (LEG_ORDER[a.leg_type] ?? 9) - (LEG_ORDER[b.leg_type] ?? 9));

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-bold">{shortName(name)}</h1>
        {trades[0] && <MarketBadge market={trades[0].market} />}
        <span className="text-sm text-muted tnum">{ticker}</span>
      </div>
      {trades.length === 0 ? <Empty>거래 내역 없음</Empty> : trades.map((t) => {
        const tlegs = sortLegs(legsByTrade.get(t.id) ?? []);
        // 1R = 신규매수(buy_new) 금액. 없으면 첫 매수 금액.
        const baseLeg = tlegs.find((l) => l.leg_type === "buy_new") ?? tlegs.find((l) => l.leg_type.startsWith("buy"));
        const baseAmt = baseLeg?.amount ?? 0;
        return (
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
            {tlegs.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="flex items-center gap-1.5">
                  <Tag tone={l.leg_type.startsWith("buy") ? "up" : "down"}>{actionLabel[l.leg_type] ?? l.leg_type}</Tag>
                  <span className="text-xs text-muted tnum">{l.d}{l.hhmm ? ` ${l.hhmm}` : ""}</span>
                </span>
                <span className="tnum">
                  {won(l.price)}원 · {l.qty.toLocaleString("ko-KR")}주
                  {rOf(l.amount, baseAmt) != null && (
                    <span className="ml-2 text-xs text-muted" title={`금액 ${won(l.amount)} · 1R=신규매수 ${won(baseAmt)}`}>
                      {rOf(l.amount, baseAmt)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        );
      })}
    </>
  );
}
