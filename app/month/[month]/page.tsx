import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { eok, won, pct, signClass, shortName } from "@/lib/format";
import { Section, Empty, MarketBadge } from "@/components/ui";
import type { Trade, MonthlyStat } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXIT_LABEL: Record<string, string> = {
  sell_3: "+7% 익절", stop: "손절", newlow_stop: "신저가손절", open: "보유중",
};

export default async function MonthDetail({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;                 // 'YYYY-MM'
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const [statRes, tradesRes] = await Promise.all([
    supabase.from("monthly_stats").select("*").eq("month", month).maybeSingle(),
    supabase.from("trades").select("*").eq("status", "closed")
      .gte("exit_date", start).lt("exit_date", next).order("exit_date", { ascending: false }),
  ]);
  const stat = statRes.data as MonthlyStat | null;
  const trades = (tradesRes.data as Trade[]) ?? [];

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link href="/dashboard" className="text-accent">◀ 대시보드</Link>
        <h1 className="text-lg font-bold">{month} 거래 상세</h1>
      </div>

      {stat && (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          {[
            { k: "월수익률", v: pct(stat.return_pct), c: signClass(stat.return_pct) },
            { k: "거래", v: `${stat.num_trades}건` },
            { k: "승률", v: `${stat.win_rate.toFixed(0)}%` },
            { k: "매수당 평균", v: pct(stat.avg_ret), c: signClass(stat.avg_ret) },
            { k: "실현손익", v: eok(stat.realized_pnl), c: signClass(stat.realized_pnl) },
            { k: "MDD", v: pct(stat.mdd_pct), c: "text-down" },
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-[var(--color-borderc)] bg-surface p-2">
              <div className="text-xs text-muted">{s.k}</div>
              <div className={`font-bold tnum ${s.c ?? ""}`}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      <Section title={`${month}에 청산된 거래 ${trades.length}건`}
        sub="종목을 누르면 매수/매도 회차별 상세(일자·가격·포트%).">
        {trades.length === 0 ? <Empty>이 달에 청산된 거래가 없습니다.</Empty> : (
          <ul className="divide-y divide-[var(--color-borderc)]">
            {trades.map((t) => (
              <li key={t.id}>
                <Link href={`/stocks/${t.ticker}`} className="flex items-center justify-between py-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{shortName(t.name)}</span>
                      <MarketBadge market={t.market} />
                      <span className="text-xs text-muted">{EXIT_LABEL[t.exit_reason ?? ""] ?? t.exit_reason}</span>
                    </span>
                    <span className="text-xs text-muted tnum">
                      {t.entry_date}~{t.exit_date} · 매수 {t.buy_count}회 · {t.holding_days}일
                    </span>
                  </span>
                  <span className="text-right tnum">
                    <span className={`font-medium ${signClass(t.pnl)}`}>{pct(t.ret_pct)}</span>
                    <span className={`block text-xs ${signClass(t.pnl)}`}>
                      {(t.pnl ?? 0) >= 0 ? "+" : ""}{won(t.pnl)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
