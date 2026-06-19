import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Section, Empty } from "@/components/ui";
import { signClass } from "@/lib/format";
import type { RsHistoryWeekly, RsMarket } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseMarket(v: string): RsMarket | null {
  return v === "KR" || v === "US" || v === "JP" ? v : null;
}

const MARKET_LABEL: Record<RsMarket, string> = { KR: "한국", US: "미국", JP: "일본" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ market: string; ticker: string }>;
}) {
  const { market, ticker } = await params;
  const tk = decodeURIComponent(ticker);
  return {
    title: `${tk} 주차별 RS — 마감지기`,
    description: `${(MARKET_LABEL as Record<string, string>)[market] ?? market} 시장 ${tk}의 최근 주차별 RS 추이.`,
  };
}

// Sparkline-like 작은 막대 (SVG, recharts 의존성 X)
// RS 강도에 따라 색·명도 단계화: 90 이상은 accent(강조색), 89 이하는 muted(회색·관심 X)
function rsBarFill(rs: number): string {
  if (rs >= 90) return "var(--color-accent)";   // RS90+: 강조색
  return "var(--color-muted)";                   // RS89 이하: 회색
}
function rsBarOpacity(rs: number): number {
  if (rs >= 96) return 1.0;       // RS96+: 진한
  if (rs >= 90) return 0.55;      // RS90~95: 중간
  return 0.40;                    // RS89 이하: 옅은 회색
}

function fmtClose(close: number | null, market: RsMarket): string {
  if (close == null) return "-";
  if (market === "US") {
    return close.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return close.toLocaleString(market === "JP" ? "ja-JP" : "ko-KR", { maximumFractionDigits: 0 });
}

function RsBars({
  data,
  market,
}: {
  data: { week_date: string; rs: number; close: number | null }[];
  market: RsMarket;
}) {
  if (data.length === 0) return null;
  const w = 100;       // viewBox width
  const h = 30;
  const bw = w / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none">
      {data.map((d, i) => {
        // RS 0~99 → 막대 높이 0~h
        const bh = Math.max(1, (d.rs / 99) * h);
        const rectW = Math.max(bw - 0.3, 0.6);
        return (
          <g key={d.week_date}>
            <rect
              x={i * bw}
              y={h - bh}
              width={rectW}
              height={bh}
              fill={rsBarFill(d.rs)}
              fillOpacity={rsBarOpacity(d.rs)}
            />
            {/* hover 영역: 막대 전체 칸을 덮어 마우스가 빈 위 공간에서도 잡히게 */}
            <rect
              x={i * bw}
              y={0}
              width={bw}
              height={h}
              fill="transparent"
            >
              <title>{`${d.week_date}  ·  RS ${d.rs}  ·  ${fmtClose(d.close, market)}`}</title>
            </rect>
          </g>
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

  // 시계열 — rs_universe_weekly (메타 정보 풍부) + rs_history_weekly (mktcap 무관 전체 시계열)
  // 둘을 합쳐서 가장 긴 시계열 노출. 소형주가 최근에야 mktcap 필터 통과한 경우에도 RS 추이 풍부.
  const [univRes, histRes, topRes] = await Promise.all([
    supabase
      .from("rs_universe_weekly")
      .select("*")
      .eq("market", market)
      .eq("ticker", ticker)
      .order("week_date", { ascending: true }),
    supabase
      .from("rs_history_weekly")
      .select("*")
      .eq("market", market)
      .eq("ticker", ticker)
      .order("week_date", { ascending: true }),
    supabase
      .from("rs_top_weekly")
      .select("name,name_en,close,mktcap")
      .eq("market", market)
      .eq("ticker", ticker)
      .order("week_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const univRows = (univRes.data as Array<RsHistoryWeekly & {
    name: string | null; name_en: string | null; mktcap: number | null;
  }> | null) ?? [];
  const histRows = (histRes.data as RsHistoryWeekly[]) ?? [];

  // week_date → universe row (있을 때) Map
  const univByWeek = new Map(univRows.map((r) => [r.week_date, r] as const));
  // 합집합 시계열 — universe 가 있는 주차는 universe row, 없으면 history row
  const byWeek = new Map<string, RsHistoryWeekly>();
  for (const r of histRows) byWeek.set(r.week_date, r);
  for (const r of univRows) byWeek.set(r.week_date, {
    market: r.market, ticker: r.ticker, week_date: r.week_date,
    rs: r.rs, comp_return: r.comp_return, close: r.close,
  });
  const hist: RsHistoryWeekly[] = Array.from(byWeek.values())
    .sort((a, b) => (a.week_date < b.week_date ? -1 : 1));

  // 메타: 최신 universe row 우선, 없으면 rs_top_weekly 마지막 row
  let meta: { name: string | null; name_en: string | null; close: number | null; mktcap: number | null } | null = null;
  if (univRows.length > 0) {
    const last = univRows[univRows.length - 1];
    meta = { name: last.name, name_en: last.name_en, close: last.close, mktcap: last.mktcap };
  } else if (topRes.data) {
    meta = topRes.data as unknown as { name: string | null; name_en: string | null; close: number | null; mktcap: number | null };
  }
  // hist 가 비어있고 univByWeek 도 없을 때 0주 (빈 페이지)
  void univByWeek;

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
        <span>{MARKET_LABEL[market]}</span>
      </div>

      <form
        action="/rs/search"
        method="get"
        className="mb-5 rounded-xl border border-accent/30 bg-accent/5 p-2.5"
      >
        <label className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-accent">
          🔍 다른 종목 RS 조회
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            name="q"
            placeholder="ticker 또는 회사명 입력 (예: 005930, 키옥시아, AAPL)"
            className="flex-1 rounded-lg border-2 border-[var(--color-borderc)] bg-bg px-3 py-2 text-sm text-textc placeholder-muted focus:border-accent focus:outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            조회
          </button>
        </div>
      </form>

      <h1 className="mb-1 text-xl font-bold">
        {meta?.name_en || meta?.name || ticker}
        <span className="ml-2 text-sm font-normal text-muted">{ticker}</span>
      </h1>
      {market === "JP" && meta?.name_en && meta?.name && meta.name !== meta.name_en && (
        <p className="mb-1 text-sm text-muted">{meta.name}</p>
      )}
      <p className="mb-5 text-xs text-muted">
        최근 {hist.length}주 RS 추이
        {top96Weeks > 0 && ` · RS96+ ${top96Weeks}주`}.
        주차 데이터는 quantBacktest 시스템의 weekly cache 에서 계산됩니다.
      </p>

      {hist.length === 0 ? (
        <Section title="데이터 없음">
          <Empty>
            이 종목의 주차별 RS 데이터가 없습니다. 시총 필터(상위 20~40%) 통과한 종목만 시계열이 제공됩니다.
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

          <Section title="주차별 RS 추이" sub="막대 — RS96+ 진한 강조색 · 90~95 중간 강조색 · 89 이하 옅은 회색(관심 외)">
            <RsBars data={hist} market={market} />
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
                            ? `${r.comp_return >= 0 ? "+" : ""}${Math.round(r.comp_return * 100)}%`
                            : "-"}
                        </td>
                        <td>
                          {r.close == null
                            ? "-"
                            : market === "US"
                              ? r.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : r.close.toLocaleString(market === "JP" ? "ja-JP" : "ko-KR", { maximumFractionDigits: 0 })}
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
