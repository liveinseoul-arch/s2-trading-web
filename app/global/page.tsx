import Link from "next/link";
import { Section, Empty } from "@/components/ui";
import { loadGlobalThemes, fetchGlobalWeeks } from "@/lib/globalTheme";
import type { GlobalThemeStock, GlobalSubcategory } from "@/lib/globalTheme";
import type { RsMarket } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "한미일 모멘텀 테마 — 선두지기(96+)",
  description:
    "한국·미국·일본 3개 시장의 RS96+ 종목을 같은 테마로 묶어 한 화면에. 3국에서 동시 가동되는 테마를 찾고, 종목 클릭으로 주차별 RS 추이를 확인하세요.",
};

const MARKET_LABEL: Record<RsMarket, string> = { KR: "한국", US: "미국", JP: "일본" };

function fmtWeek(d: string) {
  return d.slice(2);
}

function fmtCompReturn(v: number | null): string {
  if (v == null) return "-";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${Math.round(p)}%`;
}

function signClass(v: number | null): string {
  if (v == null || v === 0) return "text-muted";
  return v > 0 ? "text-up" : "text-down";
}

function DeltaBadge({
  delta,
  prevTotal,
}: {
  delta?: number | null;
  prevTotal?: number | null;
}) {
  if (delta == null) return null;
  if (delta === 0)
    return <span className="ml-1 text-[10px] text-muted">±0</span>;
  const up = delta > 0;
  const isNew = up && (prevTotal ?? 0) === 0;
  return (
    <span
      className={`ml-1 text-[10px] font-semibold tnum ${up ? "text-up" : "text-down"}`}
      title={`4주전 ${prevTotal ?? 0} → 현재`}
    >
      {isNew ? "신규" : `${up ? "▲" : "▼"}${Math.abs(delta)}`}
    </span>
  );
}

const EMA_BADGE =
  "inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-bold leading-none tracking-tight text-white";

function EmaBreakCell({ v }: { v?: number | null }) {
  if (v === 2)
    return (
      <span
        className={`${EMA_BADGE} bg-red-600`}
        title="종가가 EMA21·EMA50 모두 아래 (추세 약화)"
      >
        - -
      </span>
    );
  if (v === 1)
    return (
      <span
        className={`${EMA_BADGE} bg-amber-500`}
        title="종가가 EMA21·EMA50 중 하나 아래"
      >
        -
      </span>
    );
  return null; // 0(둘 다 위) 또는 데이터 없음 → 표시 안 함
}

const MARKET_BADGE: Record<RsMarket, string> = {
  KR: "bg-blue-500/15 text-blue-400",
  US: "bg-emerald-500/15 text-emerald-400",
  JP: "bg-rose-500/15 text-rose-400",
};

function MarketBadge({ m }: { m: RsMarket }) {
  return (
    <span
      className={`inline-flex h-5 w-7 items-center justify-center rounded text-[10px] font-bold tnum ${MARKET_BADGE[m]}`}
      title={MARKET_LABEL[m]}
    >
      {m}
    </span>
  );
}

function StockRow({ s }: { s: GlobalThemeStock }) {
  const display = s.name_en || s.name || s.ticker;
  const subTicker = s.market === "JP" ? s.ticker.replace(".T", "") : s.ticker;
  return (
    <tr className="border-b border-[var(--color-borderc)] text-right last:border-0 hover:bg-bg/40">
      <td className="py-1 text-left">
        <MarketBadge m={s.market} />
      </td>
      <td className="min-w-0 text-left">
        <Link
          href={`/rs96/${s.market}/${encodeURIComponent(s.ticker)}`}
          className="font-medium text-textc hover:text-accent"
        >
          {display}
        </Link>
        <span className="ml-2 text-[10px] text-muted">{subTicker}</span>
        {s.small && (
          <span className="ml-1.5 text-[10px] text-muted">· {s.small}</span>
        )}
      </td>
      <td className="font-semibold text-accent">{s.rs}</td>
      <td className="pl-3 tnum">
        <EmaBreakCell v={s.emaBreak} />
      </td>
      <td className={signClass(s.comp_return == null ? null : s.comp_return * 100)}>
        {fmtCompReturn(s.comp_return)}
      </td>
    </tr>
  );
}

const DEFAULT_LIMIT = 20;

function StockTable({ stocks, limit = DEFAULT_LIMIT }: { stocks: GlobalThemeStock[]; limit?: number }) {
  const visible = stocks.slice(0, limit);
  const hidden = stocks.slice(limit);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tnum">
        <thead className="text-[10px] text-muted">
          <tr className="border-b border-[var(--color-borderc)] text-right">
            <th className="py-1 text-left">국</th>
            <th className="text-left">종목</th>
            <th>RS</th>
            <th className="pl-3" title="종가의 EMA21·EMA50 이탈">MA↓</th>
            <th>모멘텀</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => (
            <StockRow key={`${s.market}-${s.ticker}`} s={s} />
          ))}
        </tbody>
      </table>
      {hidden.length > 0 && (
        <details className="group mt-1">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1 rounded border border-dashed border-[var(--color-borderc)] py-1.5 text-[11px] text-accent hover:bg-bg/40">
            <span className="group-open:hidden">+ {hidden.length}개 더 보기</span>
            <span className="hidden group-open:inline">− 접기</span>
          </summary>
          <table className="mt-1 w-full text-xs tnum">
            <tbody>
              {hidden.map((s) => (
                <StockRow key={`${s.market}-${s.ticker}-h`} s={s} />
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function ThemeCard({
  label,
  total,
  countByMarket,
  isGlobal,
  stocks,
  subcategories,
  delta,
  prevTotal,
}: {
  label: string;
  total: number;
  countByMarket: Record<RsMarket, number>;
  isGlobal: boolean;
  stocks: GlobalThemeStock[];
  subcategories?: GlobalSubcategory[];
  delta?: number | null;
  prevTotal?: number | null;
}) {
  const hasSubs = subcategories && subcategories.length > 0;
  return (
    <article
      className={`mb-4 break-inside-avoid rounded-xl border bg-surface p-4 ${
        isGlobal ? "border-accent/40" : "border-[var(--color-borderc)]"
      }`}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-textc">{label}</h3>
        <div className="flex flex-shrink-0 items-center gap-2 text-[11px]">
          {hasSubs && (
            <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-semibold text-purple-400">
              {subcategories!.length}개 세분
            </span>
          )}
          <span className="tnum text-muted">
            <span className="text-blue-400">KR {countByMarket.KR}</span>
            <span className="mx-1">·</span>
            <span className="text-emerald-400">US {countByMarket.US}</span>
            <span className="mx-1">·</span>
            <span className="text-rose-400">JP {countByMarket.JP}</span>
            <span className="ml-1.5 font-semibold text-textc">총 {total}</span>
            <DeltaBadge delta={delta} prevTotal={prevTotal} />
          </span>
        </div>
      </header>

      {hasSubs ? (
        <div className="flex flex-col gap-4">
          {subcategories!.map((sub, i) => (
            <div key={`${sub.label}-${i}`}>
              <h4 className="mb-1.5 text-xs font-semibold text-textc">
                {sub.label}
                <span className="ml-1.5 font-normal text-muted">{sub.stocks.length}</span>
                <DeltaBadge delta={sub.deltaTotal} prevTotal={sub.prevTotal} />
              </h4>
              <StockTable stocks={sub.stocks} />
            </div>
          ))}
        </div>
      ) : (
        <StockTable stocks={stocks} />
      )}
    </article>
  );
}

export default async function GlobalThemes({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const sp = await searchParams;
  const availWeeks = await fetchGlobalWeeks();
  const selectedWeek =
    sp.week && availWeeks.includes(sp.week) ? sp.week : (availWeeks[0] ?? null);

  const data = await loadGlobalThemes(selectedWeek);
  const { groups, weeks, totals, unmatched, marketSummaries, unifiedModel, subdivisionModel, compareWeek } = data;

  const noData = Object.values(weeks).every((w) => !w);
  const hasAnySummary = Object.values(marketSummaries).some((s) => s);

  return (
    <>
      <h1 className="mb-1 text-lg font-bold">한미일 모멘텀 테마</h1>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        3개 시장의 RS96+ 종목을 Gemini 가 분류한 테마로 묶어 한 화면에. <b className="text-textc">3국 동시</b> 가동되는 테마가 위쪽,
        총 종목 수 내림차순. 종목 클릭으로 주차별 RS 추이.
      </p>

      {compareWeek && (
        <p className="mb-4 -mt-2 text-[11px] text-muted">
          각 테마 <b className="text-textc">총</b> 옆{" "}
          <span className="font-semibold text-up">▲</span>/
          <span className="font-semibold text-down">▼</span> 는 약 4주전(
          <span className="tnum">{compareWeek.slice(2)}</span> 기준) 대비 종목 수 변화입니다.
        </p>
      )}

      <p className="mb-4 -mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted">
        <b className="text-textc">MA↓</b> 칸:
        <span className={`${EMA_BADGE} bg-red-600`}>- -</span> 종가가 EMA21·50 모두 아래 ·
        <span className={`${EMA_BADGE} bg-amber-500`}>-</span> 하나 아래 (RS96+ 여도 추세 약화 신호).
      </p>

      {availWeeks.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-muted">주차:</span>
          <div className="flex flex-wrap gap-1.5">
            {availWeeks.slice(0, 12).map((w) => {
              const active = w === selectedWeek;
              return (
                <Link
                  key={w}
                  href={`/global?week=${w}`}
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
            {availWeeks.length > 12 && (() => {
              const olderActive =
                selectedWeek != null && !availWeeks.slice(0, 12).includes(selectedWeek);
              return (
                <details key={selectedWeek ?? "none"} className="relative inline-block">
                  <summary
                    className={`cursor-pointer rounded px-2 py-1 text-xs ${
                      olderActive
                        ? "bg-accent font-medium text-white"
                        : "bg-surface text-muted"
                    }`}
                  >
                    이전 {availWeeks.length - 12}주
                    {olderActive && (
                      <span className="ml-1 tnum">· {fmtWeek(selectedWeek!)}</span>
                    )}{" "}
                    ▾
                  </summary>
                  <div className="absolute z-20 mt-1 grid max-h-64 w-44 grid-cols-1 gap-0.5 overflow-y-auto rounded-lg border border-[var(--color-borderc)] bg-bg p-2 shadow-lg">
                    {availWeeks.slice(12).map((w) => {
                      const active = w === selectedWeek;
                      return (
                        <Link
                          key={w}
                          href={`/global?week=${w}`}
                          className={`rounded px-2 py-1 text-xs tnum ${
                            active
                              ? "bg-accent text-white"
                              : "text-muted hover:bg-surface hover:text-textc"
                          }`}
                        >
                          {w}
                        </Link>
                      );
                    })}
                  </div>
                </details>
              );
            })()}
          </div>
        </div>
      )}

      {/* 시장별 메타 */}
      <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
        {(["KR", "US", "JP"] as RsMarket[]).map((m) => (
          <div
            key={m}
            className="rounded-lg border border-[var(--color-borderc)] bg-surface p-2"
          >
            <div className="font-semibold text-textc">
              {MARKET_LABEL[m]}{" "}
              <span className="text-[10px] font-normal text-muted">
                {weeks[m] ? weeks[m]!.slice(2) : "-"}
              </span>
            </div>
            <div className="mt-0.5 tnum text-muted">
              {totals[m]}종목
              {unmatched[m] > 0 && (
                <span className="ml-1 text-[10px]">· 미분류 {unmatched[m]}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 분류 모델 명시 */}
      {(unifiedModel || subdivisionModel) && (
        <p className="mb-3 text-[11px] text-muted">
          {unifiedModel && (
            <>
              테마 분류 <b className="text-textc">{unifiedModel.replace("gemini-", "Gemini ")}</b>
            </>
          )}
          {subdivisionModel && subdivisionModel !== unifiedModel && (
            <>
              {unifiedModel ? " · " : ""}서브 세분화{" "}
              <b className="text-textc">{subdivisionModel.replace("gemini-", "Gemini ")}</b>
            </>
          )}
          {subdivisionModel && subdivisionModel === unifiedModel && (
            <> (서브 세분화 동일 모델)</>
          )}
        </p>
      )}

      {/* Gemini 의 시장별 한줄평 */}
      {hasAnySummary && (
        <div className="mb-5 grid gap-2 sm:grid-cols-3">
          {(["KR", "US", "JP"] as RsMarket[]).map((m) =>
            marketSummaries[m] ? (
              <div
                key={m}
                className="rounded-lg border-l-2 border-accent bg-surface p-3 text-xs leading-relaxed"
              >
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-muted">
                  <MarketBadge m={m} /> Gemini 한줄평
                </div>
                <p className="text-textc">{marketSummaries[m]}</p>
              </div>
            ) : null,
          )}
        </div>
      )}

      {noData ? (
        <Section title="데이터 없음">
          <Empty>아직 적재된 테마 데이터가 없습니다. 매주 자동 갱신됩니다.</Empty>
        </Section>
      ) : groups.length === 0 ? (
        <Section title="테마 없음">
          <Empty>이번 주차에 매핑된 테마가 없습니다.</Empty>
        </Section>
      ) : (
        <div className="gap-4 [column-fill:_balance] columns-1 sm:columns-2 lg:columns-3">
          {groups.map((g) => (
            <ThemeCard
              key={g.key}
              label={g.label}
              total={g.total}
              countByMarket={g.countByMarket}
              isGlobal={g.isGlobal}
              stocks={g.allStocks}
              subcategories={g.subcategories}
              delta={g.deltaTotal}
              prevTotal={g.prevTotal}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted">
        테마는 Gemini 가 시장별로 분류한 결과를 <b>이름 정규화</b>로 통합한 것입니다(예: &quot;AI 인프라&quot; ≈ &quot;AI infrastructure&quot;).
        시장별 분류 시점·기준이 미세하게 다를 수 있어 100% 정확한 통합은 아니며,
        같은 테마가 다른 이름으로 흩어져 있을 수 있습니다. 종목별 RS 시계열은 종목명 클릭.
      </p>
    </>
  );
}
