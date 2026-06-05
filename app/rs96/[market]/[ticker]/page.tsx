import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Section, Empty } from "@/components/ui";
import { signClass } from "@/lib/format";
import type { RsHistoryWeekly, RsMarket } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseMarket(v: string): RsMarket | null {
  return v === "KR" || v === "US" ? v : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ market: string; ticker: string }>;
}) {
  const { market, ticker } = await params;
  const tk = decodeURIComponent(ticker);
  return {
    title: `${tk} 주차별 RS — 마감지기`,
    description: `${market === "KR" ? "한국" : "미국"} 시장 ${tk}의 최근 주차별 RS 추이.`,
  };
}

// Sparkline-like 작은 막대 (SVG, recharts 의존성 X)
function RsBars({ data }: { data: { week_date: string; rs: number }[] }) {
  if (data.length === 0) return null;
  const w = 100;       // viewBox width
  const h = 30;
  const bw = w / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none">
      {data.map((d, i) => {
        // RS 0~99 → 막대 높이 0~h
        const bh = Math.max(1, (d.rs / 99) * h);
        const isTop = d.rs >= 96;
        return (
          <rect
            key={d.week_date}
            x={i * bw}
            y={h - bh}
            width={Math.max(bw - 0.3, 0.6)}
            height={bh}
            fill={isTop ? "var(--color-accent)" : "var(--color-borderc)"}
          />
        );
      })}
    </svg>
  );
}

export default async function RsTickerHistory({
  params,
}: {
  params: Promise<{ market: string; ticker: string }>;
}) {
  const { market: marketParam, ticker: tickerParam } = await params;
  const market = parseMarket(marketParam);
  if (!market) notFound();

  const ticker = decodeURIComponent(tickerParam);

  // 시계열 + 종목 이름(top 테이블에서 가장 최근 행으로 보강)
  const [histRes, nameRes] = await Promise.all([
    supabase
      .from("rs_history_weekly")
      .select("*")
      .eq("market", market)
      .eq("ticker", ticker)
      .order("week_date", { ascending: true }),
    supabase
      .from("rs_top_weekly")
      .select("name,close,mktcap")
      .eq("market", market)
      .eq("ticker", ticker)
      .order("week_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const hist = (histRes.data as RsHistoryWeekly[]) ?? [];
  const meta = nameRes.data as { name: string | null; close: number | null; mktcap: number | null } | null;

  // 최근이 위에 오도록 표 정렬용 (역순)
  const tableRows = [...hist].reverse();
  const top96Weeks = hist.filter((h) => h.rs >= 96).length;
  const latest = hist[hist.length - 1];
  const rsAvg = hist.length ? hist.reduce((s, h) => s + h.rs, 0) / hist.length : 0;
  const rsMax = hist.length ? Math.max(...hist.map((h) => h.rs)) : 0;
  const rsMin = hist.length ? Math.min(...hist.map((h) => h.rs)) : 0;

  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-xs text-muted">
        <Link href={`/rs96?market=${market}`} className="hover:text-accent">
          ← RS96+ 목록
        </Link>
        <span>·</span>
        <span>{market === "KR" ? "한국" : "미국"}</span>
      </div>

      <h1 className="mb-1 text-xl font-bold">
        {meta?.name || ticker}
        <span className="ml-2 text-sm font-normal text-muted">{ticker}</span>
      </h1>
      <p className="mb-5 text-xs text-muted">
        RS96+ 에 한 번이라도 들어간 종목의 최근 {hist.length}주 RS 추이.
        주차 데이터는 quantBacktest 시스템의 weekly cache에서 계산됩니다.
      </p>

      {hist.length === 0 ? (
        <Section title="데이터 없음">
          <Empty>
            이 종목의 주차별 RS 데이터가 없습니다. RS96+ 목록에 등재된 적이 있는 종목만 시계열이 제공됩니다.
          </Empty>
        </Section>
      ) : (
        <>
          {/* 요약 stat */}
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="최신 RS" value={String(latest.rs)} tone="text-accent" />
            <Stat label="평균 RS" value={rsAvg.toFixed(1)} />
            <Stat label="최고 RS" value={String(rsMax)} />
            <Stat label="RS96+ 주" value={`${top96Weeks}주`} />
          </div>

          <Section title="주차별 RS 추이" sub="진한 막대 = RS96+ (상위 4%) · 옅은 막대 = 그 외">
            <RsBars data={hist} />
            <div className="mt-2 flex justify-between text-[11px] text-muted">
              <span>{hist[0]?.week_date}</span>
              <span>RS 범위: {rsMin} ~ {rsMax}</span>
              <span>{hist[hist.length - 1]?.week_date}</span>
            </div>
          </Section>

          <Section title={`주차별 표 · ${hist.length}주`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tnum">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-[var(--color-borderc)] text-right">
                    <th className="py-1.5 pl-1 text-left">주차</th>
                    <th>RS</th>
                    <th>52주 모멘텀</th>
                    <th>종가</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => {
                    const isTop = r.rs >= 96;
                    return (
                      <tr
                        key={r.week_date}
                        className={`border-b border-[var(--color-borderc)] text-right last:border-0 ${
                          isTop ? "" : "text-muted"
                        }`}
                      >
                        <td className="py-1.5 pl-1 text-left">{r.week_date}</td>
                        <td className={isTop ? "font-bold text-accent" : ""}>{r.rs}</td>
                        <td className={signClass(r.comp_return ? r.comp_return * 100 : null)}>
                          {r.comp_return != null
                            ? `${r.comp_return >= 0 ? "+" : ""}${(r.comp_return * 100).toFixed(1)}%`
                            : "-"}
                        </td>
                        <td>
                          {r.close == null
                            ? "-"
                            : market === "US"
                              ? r.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : r.close.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-borderc)] bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-xl font-bold tnum ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
