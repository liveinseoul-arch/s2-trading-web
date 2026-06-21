import { redirect } from "next/navigation";
import { supabase, latestDate, getMeta } from "@/lib/supabase";
import SummaryBar from "@/components/SummaryBar";
import CandidateList from "@/components/CandidateList";
import WatchOrderPlan from "@/components/WatchOrderPlan";
import ExecutionList from "@/components/ExecutionList";
import PositionList from "@/components/PositionList";
import type { NavDaily, OrderPlan, Execution, PositionSnapshot, DailyCandidate } from "@/lib/types";
import { IS_RS96 } from "@/lib/site";

export const dynamic = "force-dynamic"; // 요청 시 Supabase 읽기(공개 읽기 서비스). 캐싱은 추후 ISR 전환 가능.

export default async function Home() {
  if (IS_RS96) redirect("/rs96");
  const d = await latestDate();
  const meta = await getMeta();
  if (!d) {
    return <p className="py-10 text-center text-muted">데이터가 아직 없습니다. EOD 익스포터를 먼저 실행하세요.</p>;
  }
  const [nav, cands, plan, execs, positions, first, minDd] = await Promise.all([
    supabase.from("nav_daily").select("*").eq("d", d).single(),
    supabase.from("daily_candidates").select("*").eq("d", d).eq("kind", "new").order("reached", { ascending: false }).order("drop_to_pct", { ascending: false }),
    supabase.from("daily_order_plan").select("*").eq("d", d),
    supabase.from("executions").select("*").eq("d", d),
    supabase.from("position_snapshots").select("*").eq("d", d).order("eval_amount", { ascending: false }),
    supabase.from("nav_daily").select("d,nav").order("d", { ascending: true }).limit(1).single(),
    supabase.from("nav_daily").select("dd_pct").order("dd_pct", { ascending: true }).limit(1).single(),
  ]);

  const navRow = (nav.data as NavDaily) ?? null;
  const firstRow = (first.data as { d: string; nav: number }) ?? null;
  const BASE_CAP = 1e8;
  const years = firstRow && navRow
    ? (new Date(navRow.d).getTime() - new Date(firstRow.d).getTime()) / (365.25 * 864e5)
    : 0;
  const cagrPct = navRow && years > 0
    ? ((navRow.nav / BASE_CAP) ** (1 / years) - 1) * 100
    : null;
  const mddPct = (minDd.data as { dd_pct: number } | null)?.dd_pct ?? null;
  const startDate = firstRow?.d ?? null;

  return (
    <>
      <SummaryBar
        nav={navRow}
        date={d}
        lastEod={String(meta.last_eod_at ?? "-")}
        startDate={startDate}
        cagr={cagrPct}
        mdd={mddPct}
      />
      <CandidateList cands={(cands.data as DailyCandidate[]) ?? []} />
      <WatchOrderPlan plan={(plan.data as OrderPlan[]) ?? []} />
      <ExecutionList execs={(execs.data as Execution[]) ?? []} title={`${d} 체결`}
        sub="모델 기준 당일 신규·추가 매수 및 매도·손절 체결" />
      <PositionList positions={(positions.data as PositionSnapshot[]) ?? []} />
    </>
  );
}
