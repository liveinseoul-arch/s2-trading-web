import Link from "next/link";
import { supabase, getMeta } from "@/lib/supabase";
import { Section, Empty } from "@/components/ui";
import { pct, signClass } from "@/lib/format";
import type { RsMarket, RsTopWeekly } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "RS96+ 주간 종목 — 마감지기",
  description:
    "한국·미국 시장의 상위 4% 모멘텀 종목(RS96 이상)을 주별로 정리. O'Neil CANSLIM·Minervini SEPA 변형 룰의 기본 후보군.",
};

const MARKETS: { key: RsMarket; label: string }[] = [
  { key: "KR", label: "한국" },
  { key: "US", label: "미국" },
];

function parseMarket(v: string | string[] | undefined): RsMarket {
  return v === "US" ? "US" : "KR";
}

function fmtWeek(d: string) {
  return d.slice(2);   // 26-05-18 형식
}

function fmtMktcap(v: number | null, market: RsMarket) {
  if (v == null) return "-";
  if (market === "KR") return `${Math.round(v / 1e8).toLocaleString("ko-KR")}억`;
  // USD
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  return `$${Math.round(v / 1e6).toLocaleString("en-US")}M`;
}

function fmtPrice(v: number | null, market: RsMarket) {
  if (v == null) return "-";
  return market === "US"
    ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

export default async function RsScreen({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; week?: string }>;
}) {
  const sp = await searchParams;
  const market = parseMarket(sp.market);

  // 이용 가능한 주차 목록 (현재 시장)
  const weeksRes = await supabase
    .from("rs_top_weekly")
    .select("week_date")
    .eq("market", market)
    .order("week_date", { ascending: false });

  const weekRows = (weeksRes.data as { week_date: string }[]) ?? [];
  const weeks = Array.from(new Set(weekRows.map((r) => r.week_date)));
  const selectedWeek = sp.week && weeks.includes(sp.week) ? sp.week : weeks[0];

  // 선택 주차의 종목들
  let rows: RsTopWeekly[] = [];
  if (selectedWeek) {
    const r = await supabase
      .from("rs_top_weekly")
      .select("*")
      .eq("market", market)
      .eq("week_date", selectedWeek)
      .order("rank_in_week", { ascending: true });
    rows = (r.data as RsTopWeekly[]) ?? [];
  }

  const meta = await getMeta();
  const lastRun = meta["last_rs_weekly_at"] as string | null;

  return (
    <>
      <h1 className="mb-1 text-lg font-bold">RS96+ 주간 종목</h1>
      <p className="mb-4 text-xs text-muted">
        12·24·36·48주 가중 수익률 백분위 상위 4%(RS 96~99). 한국은 시총 상위 40% AND 5,000억 이상,
        미국은 시총 상위 20%만(필터로 소형주·noisy 종목 제거). 자세한 규칙은{" "}
        <Link href="/rules/rs96" className="text-accent hover:underline">규칙(RS96+)</Link>.
        {lastRun ? <> · 마지막 갱신 {String(lastRun).slice(0, 16).replace("T", " ")}</> : null}
      </p>

      {/* 시장 토글 */}
      <div className="mb-4 flex gap-2">
        {MARKETS.map((m) => {
          const active = m.key === market;
          return (
            <Link
              key={m.key}
              href={`/rs96?market=${m.key}`}
              className={`rounded-lg px-4 py-1.5 text-sm transition ${
                active
                  ? "bg-accent text-white"
                  : "border border-[var(--color-borderc)] text-muted hover:text-textc"
              }`}
            >
              {m.label}
            </Link>
          );
        })}
      </div>

      {/* 주차 셀렉터 */}
      {weeks.length === 0 ? (
        <Section title="데이터 없음">
          <Empty>아직 적재된 RS96+ 데이터가 없습니다. 매주 토요일 자동 갱신됩니다.</Empty>
        </Section>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-muted">주차:</span>
            <div className="flex flex-wrap gap-1.5">
              {weeks.slice(0, 12).map((w) => {
                const active = w === selectedWeek;
                return (
                  <Link
                    key={w}
                    href={`/rs96?market=${market}&week=${w}`}
                    className={`rounded px-2 py-1 text-xs tnum ${
                      active
                        ? "bg-accent text-white"
                        : "bg-surface text-muted hover:text-textc"
                    }`}
                  >
                    {fmtWeek(w)}
                  </Link>
                );
              })}
              {weeks.length > 12 && (
                <details className="relative inline-block">
                  <summary className="cursor-pointer rounded bg-surface px-2 py-1 text-xs text-muted">
                    이전 {weeks.length - 12}주 ▾
                  </summary>
                  <div className="absolute z-20 mt-1 grid max-h-64 w-44 grid-cols-1 gap-0.5 overflow-y-auto rounded-lg border border-[var(--color-borderc)] bg-bg p-2 shadow-lg">
                    {weeks.slice(12).map((w) => (
                      <Link
                        key={w}
                        href={`/rs96?market=${market}&week=${w}`}
                        className="rounded px-2 py-1 text-xs tnum text-muted hover:bg-surface hover:text-textc"
                      >
                        {w}
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>

          <Section
            title={`${market === "KR" ? "한국" : "미국"} · ${selectedWeek} · ${rows.length}종목`}
            sub="종목을 누르면 그 종목의 주차별 RS 추이를 볼 수 있습니다."
          >
            {rows.length === 0 ? (
              <Empty>해당 주차에 RS96+ 종목이 없습니다.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tnum">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-[var(--color-borderc)] text-right">
                      <th className="py-1.5 pl-1 text-left">#</th>
                      <th className="text-left">종목</th>
                      <th>RS</th>
                      <th>52주 모멘텀</th>
                      <th>종가</th>
                      <th>시총</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.ticker}
                        className="border-b border-[var(--color-borderc)] text-right last:border-0 hover:bg-surface"
                      >
                        <td className="py-1.5 pl-1 text-left text-muted">{r.rank_in_week}</td>
                        <td className="text-left">
                          <Link
                            href={`/rs96/${market}/${encodeURIComponent(r.ticker)}`}
                            className="font-medium text-textc hover:text-accent"
                          >
                            {r.name || r.ticker}
                          </Link>
                          <span className="ml-2 text-[11px] text-muted">{r.ticker}</span>
                        </td>
                        <td className="font-bold text-accent">{r.rs}</td>
                        <td className={signClass(r.comp_return ? r.comp_return * 100 : null)}>
                          {r.comp_return != null
                            ? `${r.comp_return >= 0 ? "+" : ""}${(r.comp_return * 100).toFixed(1)}%`
                            : "-"}
                        </td>
                        <td>{fmtPrice(r.close, market)}</td>
                        <td>{fmtMktcap(r.mktcap, market)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <p className="text-xs text-muted">
            <b>RS</b>는 IBD/Minervini 정의의 상대강도 백분위(0~99). RS 96 = 상위 4%.
            <b className="ml-2">52주 모멘텀</b>은 백테스트 본체의 composite return —
            12주 가중치 2배, 24·36·48주 가중치 1배의 누적 수익률.
            분할·액면병합 보정 누락 종목은 극단값이 나올 수 있으니 RS 등급만 기준으로 보세요.
          </p>
        </>
      )}
    </>
  );
}
