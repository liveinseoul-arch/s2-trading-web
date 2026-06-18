import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Section, Empty } from "@/components/ui";
import type { RsMarket } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "RS 조회 — 선두지기(96+)",
  description:
    "한국·미국·일본 종목 ticker 또는 회사명으로 검색해 그 종목의 주차별 RS 추이를 확인하세요.",
};

const MARKET_LABEL: Record<RsMarket, string> = { KR: "한국", US: "미국", JP: "일본" };
const MARKET_BADGE: Record<RsMarket, string> = {
  KR: "bg-blue-500/15 text-blue-400",
  US: "bg-emerald-500/15 text-emerald-400",
  JP: "bg-rose-500/15 text-rose-400",
};

interface UniverseRow {
  market: RsMarket;
  ticker: string;
  name: string | null;
  name_en: string | null;
  rs: number;
  comp_return: number | null;
  close: number | null;
  mktcap: number | null;
  week_date: string;
}

function fmtMktcap(v: number | null, market: RsMarket) {
  if (v == null) return "-";
  if (market === "KR") return Math.round(v / 1e8).toLocaleString("ko-KR");
  if (market === "JP") return Math.round(v / 1e8).toLocaleString("ja-JP");
  return Math.round(v / 1e6).toLocaleString("en-US");
}

function mktcapUnit(market: RsMarket): string {
  if (market === "KR") return "억원";
  if (market === "JP") return "억엔";
  return "M $";
}

async function fetchLatestWeek(): Promise<string | null> {
  const r = await supabase
    .from("rs_universe_weekly")
    .select("week_date")
    .order("week_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return r.data?.week_date ?? null;
}

async function searchUniverse(query: string, latestWeek: string): Promise<UniverseRow[]> {
  const q = query.trim();
  if (!q) return [];

  // 최신 주차에서 검색 — 같은 종목의 여러 주차 중복 방지.
  // 1) ticker 시작/포함 매치  2) name/name_en 포함 매치
  // PostgREST or 필터: ticker.ilike.%q%,name.ilike.%q%,name_en.ilike.%q%
  const pat = q.replace(/[%_,]/g, "");                  // simple escape
  const orFilter = [
    `ticker.ilike.%${pat}%`,
    `name.ilike.%${pat}%`,
    `name_en.ilike.%${pat}%`,
  ].join(",");

  const r = await supabase
    .from("rs_universe_weekly")
    .select("*")
    .eq("week_date", latestWeek)
    .or(orFilter)
    .order("mktcap", { ascending: false, nullsFirst: false })
    .limit(50);

  if (r.error) return [];
  return (r.data as UniverseRow[]) ?? [];
}

export default async function RsSearch({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const query = sp.q?.trim() ?? "";

  const latestWeek = await fetchLatestWeek();
  const results: UniverseRow[] = query && latestWeek
    ? await searchUniverse(query, latestWeek)
    : [];

  // 단일 매치(특히 ticker 정확 일치) 면 다이렉트 라우팅
  if (query && results.length === 1) {
    const r = results[0];
    redirect(`/rs96/${r.market}/${encodeURIComponent(r.ticker)}`);
  }
  // 또는 ticker 가 query 와 정확 일치하면 다이렉트
  if (query && results.length > 0) {
    const exact = results.find(
      (r) =>
        r.ticker.toLowerCase() === query.toLowerCase() ||
        r.ticker.replace(/\.(KS|KQ|T)$/i, "").toLowerCase() === query.toLowerCase(),
    );
    if (exact) {
      redirect(`/rs96/${exact.market}/${encodeURIComponent(exact.ticker)}`);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-bold">RS 조회</h1>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        한국·미국·일본 종목의 <b className="text-textc">ticker</b> 또는 <b className="text-textc">회사명</b>
        으로 검색. 시총 필터(상위 20~40%) 통과 종목의 주차별 RS 추이를 확인합니다.
        결과 클릭 → 그 종목 RS 히스토리.
      </p>

      <form action="/rs/search" method="get" className="mb-6 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="예: 005930, 삼성전자, AAPL, 7203, Toyota"
          className="flex-1 rounded-lg border border-[var(--color-borderc)] bg-surface px-3 py-2 text-sm text-textc placeholder-muted focus:border-accent focus:outline-none"
          autoFocus
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          검색
        </button>
      </form>

      {!query ? (
        <p className="text-xs text-muted">
          ticker 가 정확하거나 검색 결과가 단일이면 바로 상세 화면으로 이동합니다. 후보가 여럿이면 아래에 목록으로 표시.
        </p>
      ) : results.length === 0 ? (
        <Section title="결과 없음">
          <Empty>
            &quot;{query}&quot; 와 일치하는 종목을 찾지 못했습니다. 시총 상위 20~40% 안의 종목만 검색됩니다.
            ticker 의 정확한 형태(예: 005930.KS, 7203.T, AAPL)나 회사명 일부로 다시 시도해보세요.
          </Empty>
        </Section>
      ) : (
        <Section title={`검색 결과 — ${results.length}건 (시총 내림차순)`}>
          <ul className="divide-y divide-[var(--color-borderc)]">
            {results.map((r) => (
              <li key={`${r.market}-${r.ticker}`}>
                <Link
                  href={`/rs96/${r.market}/${encodeURIComponent(r.ticker)}`}
                  className="flex items-center justify-between gap-2 py-2.5 text-sm hover:bg-bg/40"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={`inline-flex h-5 w-7 items-center justify-center rounded text-[10px] font-bold tnum ${MARKET_BADGE[r.market]}`}
                      title={MARKET_LABEL[r.market]}
                    >
                      {r.market}
                    </span>
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-textc">
                        {r.name_en || r.name || r.ticker}
                      </span>
                      <span className="ml-2 text-[11px] text-muted">{r.ticker}</span>
                      {r.market === "JP" && r.name_en && r.name && r.name !== r.name_en && (
                        <span className="ml-1.5 text-[11px] text-muted">· {r.name}</span>
                      )}
                    </span>
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-3 tnum text-xs">
                    <span>
                      <span className="text-muted">RS </span>
                      <b className="text-accent">{r.rs}</b>
                    </span>
                    <span className="text-muted">
                      {fmtMktcap(r.mktcap, r.market)}
                      <span className="ml-0.5 text-[10px]">{mktcapUnit(r.market)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {latestWeek && (
        <p className="mt-4 text-xs text-muted">
          최신 데이터 기준: {latestWeek}. 검색은 이 주차의 시총 필터 통과 종목 풀에서 수행됩니다.
        </p>
      )}
    </>
  );
}
