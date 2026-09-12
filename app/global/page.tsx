import Link from "next/link";
import { Section, Empty } from "@/components/ui";
import { loadGlobalThemes, fetchGlobalWeeks } from "@/lib/globalTheme";
import { EMA_BADGE, EmaBreakBadge, emaDimClass, emaDimTitle } from "@/components/EmaBreak";
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

/**
 * 3국 통합 평가의견 — 「표제: 내용」 3줄을 표제/내용으로 갈라 읽기 쉽게 보여준다.
 *
 * 한 문단으로 길게 이어지면 무슨 얘기인지 섞여 읽히지 않는다는 지적이 있어
 * 줄마다 표제를 세워 시선이 걸리게 했다.
 * 옛 데이터(표제 없는 한 문단)는 그대로 문단으로 떨어뜨린다.
 */
function UnifiedSummary({
  text,
  model,
  subModel,
}: {
  text: string;
  model?: string | null;
  subModel?: string | null;
}) {
  // 분류 모델 표기 — 한 줄을 따로 차지하지 않도록 이 카드 헤더 오른쪽 끝에 둔다.
  // 부가 정보라 좁은 화면(모바일)에서는 감춘다.
  const modelLabel = (m?: string | null) => (m ? m.replace("gemini-", "Gemini ") : null);
  const parts: string[] = [];
  if (model) parts.push(`테마 분류 ${modelLabel(model)}`);
  if (subModel && subModel !== model) parts.push(`서브 세분화 ${modelLabel(subModel)}`);

  // ★모델이 개행을 빠뜨려도 3절로 나눈다 — 2026-09-12.
  // classify_global_themes.py 의 프롬프트가 `주도 테마 / 이번 주 변화 / 국면 평가`
  // 3줄을 요구하지만, gemini-2.5-flash 는 개행 없이 한 덩어리로 답하는 일이 있다
  // (실측 — 2026-09-11 주차는 뭉쳤고 pro 가 쓴 09-04 는 개행을 지켰다).
  // 개행이 이미 있으면 이 치환은 무해하고, 없으면 표제 앞에서 끊는다.
  // ⚠️표제 목록은 그 프롬프트와 한 벌이다 — 프롬프트를 고치면 여기도 고친다.
  const normalized = text.replace(
    /\s*(주도 테마|이번 주 변화|국면 평가)\s*:/g,
    "\n$1:",
  );

  const rows = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      // 표제가 지나치게 길면 본문 속 콜론이므로 표제로 보지 않는다
      if (i > 0 && i <= 12) {
        return { label: line.slice(0, i).trim(), text: line.slice(i + 1).trim() };
      }
      return { label: null, text: line };
    });
  const labeled = rows.some((r) => r.label);

  return (
    <div className="mb-5 rounded-lg border-l-2 border-accent bg-accent/5 p-4">
      <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold text-muted">
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">한 · 미 · 일</span>
        3국 통합 평가의견
        {parts.length > 0 && (
          <span className="ml-auto hidden font-normal text-muted sm:inline">
            {parts.join(" · ")}
          </span>
        )}
      </div>
      {labeled ? (
        <dl className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="sm:flex sm:gap-3">
              {r.label && (
                <dt className="mb-0.5 shrink-0 text-[11px] font-semibold text-accent sm:mb-0 sm:w-[76px] sm:pt-[3px] sm:text-right">
                  {r.label}
                </dt>
              )}
              <dd className="min-w-0 text-[13px] leading-[1.7] text-textc">{r.text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] leading-[1.75] text-textc">{text}</p>
      )}
    </div>
  );
}

function StockRow({ s }: { s: GlobalThemeStock }) {
  const display = s.name_en || s.name || s.ticker;
  const subTicker = s.market === "JP" ? s.ticker.replace(".T", "") : s.ticker;

  // EMA 이탈 종목은 이름을 흐리게 — 농도는 /rs96 과 공유한다(components/EmaBreak)
  const dimClass = emaDimClass(s.emaBreak);
  const dimTitle = emaDimTitle(s.emaBreak);

  return (
    <tr className="border-b border-[var(--color-borderc)] text-right last:border-0 hover:bg-bg/40">
      <td className="py-1 text-left">
        <MarketBadge m={s.market} />
      </td>
      <td className={`min-w-0 text-left ${dimClass}`} title={dimTitle}>
        <Link
          href={`/rs96/${s.market}/${encodeURIComponent(s.ticker)}`}
          className={`${dimClass ? "font-normal" : "font-medium"} text-textc hover:text-accent hover:opacity-100`}
        >
          {display}
        </Link>
        <span className="ml-2 text-[10px] text-muted">{subTicker}</span>
        {s.small && (
          <span className="ml-1.5 text-[10px] text-muted">· {s.small}</span>
        )}
      </td>
      <td className="font-semibold text-accent">{s.rs}</td>
      <td className="pl-3 text-left tnum">
        <EmaBreakBadge bits={s.emaBreak} />
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
            <th className="pl-3 text-left" title="종가의 EMA21·EMA50 이탈 (왼=21 하향, 오른=50 하향)">MA↓</th>
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
  const { groups, weeks, totals, unmatched, unifiedModel, unifiedSummary, subdivisionModel, compareWeek } = data;

  const noData = Object.values(weeks).every((w) => !w);

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
        <span className={`${EMA_BADGE} bg-red-400`}>-</span> 종가가 21EMA 아래 ·
        <span className={`${EMA_BADGE} bg-red-700`}>-</span> 50EMA 아래 (둘 다면 나란히, RS96+ 여도 추세 약화 신호).
        {" "}이탈 종목은 <span className="opacity-60">종목명을 흐리게</span>, 둘 다 이탈이면{" "}
        <span className="opacity-40">더 흐리게</span> 표시합니다 — 매수 관점에서 주목을 끌지 않게.
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

      {/* 3국을 한 호출로 본 Gemini 통합 한줄평 —
          시장별 한줄평은 각국 페이지에서도 볼 수 있어 새롭지 않은 반면,
          이것은 한미일을 묶어야만 나오는 관점이라 이 페이지의 고유 정보다. */}
      {unifiedSummary && (
        <UnifiedSummary
          text={unifiedSummary}
          model={unifiedModel}
          subModel={subdivisionModel}
        />
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
