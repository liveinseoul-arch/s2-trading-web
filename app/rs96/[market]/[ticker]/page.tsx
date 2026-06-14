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
      .select("name,name_en,close,mktcap")
      .eq("market", market)
      .eq("ticker", ticker)
      .order("week_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const hist = (histRes.data as RsHistoryWeekly[]) ?? [];
  const meta = nameRes.data as { name: string | null; name_en: string | null; close: number | null; mktcap: number | null } | null;

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

      <h1 className="mb-1 text-xl font-bold">
        {meta?.name_en || meta?.name || ticker}
        <span className="ml-2 text-sm font-normal text-muted">{ticker}</span>
      </h1>
      {market === "JP" && meta?.name_en && meta?.name && meta.name !== meta.name_en && (
        <p className="mb-1 text-sm text-muted">{meta.name}</p>
      )}
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
