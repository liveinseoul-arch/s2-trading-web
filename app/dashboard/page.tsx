import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { eok, pct, signClass } from "@/lib/format";
import { Section, Empty } from "@/components/ui";
import type { MonthlyStat, NavDaily, Trade, DailyCount } from "@/lib/types";

export const dynamic = "force-dynamic";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-borderc)] bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-xl font-bold tnum ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export default async function Dashboard() {
  const [first, last, minDd, tradesRes, monthlyRes, recentCounts, topCounts] = await Promise.all([
    supabase.from("nav_daily").select("*").order("d", { ascending: true }).limit(1).single(),
    supabase.from("nav_daily").select("*").order("d", { ascending: false }).limit(1).single(),
    supabase.from("nav_daily").select("dd_pct,d").order("dd_pct", { ascending: true }).limit(1).single(),
    supabase.from("trades").select("pnl,ret_pct,status").eq("status", "closed"),
    supabase.from("monthly_stats").select("*").order("month", { ascending: false }),
    supabase.from("daily_counts").select("*").order("d", { ascending: false }).limit(30),
    supabase.from("daily_counts").select("*").order("n_candidates", { ascending: false }).limit(10),
  ]);
  const recent = (recentCounts.data as DailyCount[]) ?? [];
  const top = (topCounts.data as DailyCount[]) ?? [];

  const f = first.data as NavDaily, l = last.data as NavDaily;
  const base = 5e8;
  const years = f && l ? (new Date(l.d).getTime() - new Date(f.d).getTime()) / (365.25 * 864e5) : 0;
  const cagr = l && years > 0 ? ((l.nav / base) ** (1 / years) - 1) * 100 : 0;
  const mdd = (minDd.data as { dd_pct: number })?.dd_pct ?? 0;
  const calmar = mdd < 0 ? Math.abs(cagr / mdd) : 0;
  const trades = (tradesRes.data as Trade[]) ?? [];
  const win = trades.length ? (trades.filter((t) => (t.pnl ?? 0) > 0).length / trades.length) * 100 : 0;
  const avgRet = trades.length ? trades.reduce((s, t) => s + (t.ret_pct ?? 0), 0) / trades.length : 0;
  const monthly = (monthlyRes.data as MonthlyStat[]) ?? [];

  return (
    <>
      <h1 className="mb-3 text-lg font-bold">월별 대시보드</h1>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="CAGR" value={pct(cagr)} tone={signClass(cagr)} />
        <Stat label="MDD" value={pct(mdd)} tone="text-down" />
        <Stat label="Calmar" value={calmar.toFixed(2)} />
        <Stat label="완결 거래" value={`${trades.length}건`} />
        <Stat label="승률" value={`${win.toFixed(1)}%`} />
        <Stat label="매수당 평균" value={pct(avgRet)} tone={signClass(avgRet)} />
      </div>
      <p className="mb-4 text-xs text-muted">
        기준자본 5억 · 무비용·0버퍼 모델(주문가 기준). 실제 결과는 슬리피지·수수료·세금으로 다를 수 있음.
        장기(12년 시점정확) 검증 Calmar ~0.7 — 자세히는 규칙 화면 참고.
      </p>

      <Section title="월별 성과" sub="월을 누르면 그 달에 청산된 거래 종목 상세.">
        {monthly.length === 0 ? <Empty>데이터 없음</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tnum">
              <thead className="text-xs text-muted">
                <tr className="border-b border-[var(--color-borderc)] text-right">
                  <th className="py-1.5 text-left">월</th><th>월수익률</th><th>거래</th>
                  <th>승률</th><th>평균</th><th>실현손익</th><th>MDD</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.month} className="border-b border-[var(--color-borderc)] text-right last:border-0">
                    <td className="py-1.5 text-left font-medium">
                      <Link href={`/month/${m.month}`} className="text-accent">{m.month}</Link>
                    </td>
                    <td className={signClass(m.return_pct)}>{pct(m.return_pct)}</td>
                    <td>{m.num_trades}</td>
                    <td>{m.win_rate.toFixed(0)}%</td>
                    <td className={signClass(m.avg_ret)}>{pct(m.avg_ret)}</td>
                    <td className={signClass(m.realized_pnl)}>{eok(m.realized_pnl)}</td>
                    <td className="text-down">{pct(m.mdd_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="예비후보 최다일 Top 10"
        sub="예비후보(지지선 근접+이탈)가 많은 날 = 거래가 몰릴 가능성이 큰 날. 날짜를 누르면 그날 상세.">
        {top.length === 0 ? <Empty>데이터 없음</Empty> : (
          <ul className="divide-y divide-[var(--color-borderc)]">
            {top.map((c) => (
              <li key={c.d}>
                <Link href={`/day/${c.d}`} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{c.d}</span>
                  <span className="tnum text-muted">
                    예비후보 <b className="text-up">{c.n_candidates}</b>
                    <span className="mx-1">·</span>매수 <b className="text-textc">{c.n_bought}</b>
                    {c.n_blocked > 0 && <span className="text-warn"> (미체결 {c.n_blocked})</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="일자별 예비후보 vs 실제 매수 (최근 30거래일)">
        {recent.length === 0 ? <Empty>데이터 없음</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tnum">
              <thead className="text-xs text-muted">
                <tr className="border-b border-[var(--color-borderc)] text-right">
                  <th className="py-1.5 text-left">날짜</th><th>예비후보</th><th>지지선이탈</th>
                  <th>실제매수</th><th>미체결</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.d} className="border-b border-[var(--color-borderc)] text-right last:border-0">
                    <td className="py-1.5 text-left"><Link href={`/day/${c.d}`} className="text-accent">{c.d}</Link></td>
                    <td className={c.n_candidates > 0 ? "font-medium text-up" : "text-muted"}>{c.n_candidates}</td>
                    <td>{c.n_reached}</td>
                    <td className="font-medium">{c.n_bought}</td>
                    <td className={c.n_blocked > 0 ? "text-warn" : "text-muted"}>{c.n_blocked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <p className="text-xs text-muted">
        ※ 예비후보=지지선(20일선 −20%) 근접·이탈 + 거래대금 스파이크·리셋 충족(근접 5% 포함).
        지지선이탈=종가 지지선 이하(체결가능). 실제매수=레버 1.3배 한도 내 체결. NAV 곡선 차트는 후속 추가 예정.
      </p>
    </>
  );
}
