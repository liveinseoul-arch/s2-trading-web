import Link from "next/link";
import { Section, Empty } from "@/components/ui";
import { loadGlobalThemes } from "@/lib/globalTheme";
import type { GlobalThemeStock } from "@/lib/globalTheme";
import type { RsMarket } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "한미일 모멘텀 테마 — 선두지기(96+)",
  description:
    "한국·미국·일본 3개 시장의 RS96+ 종목을 같은 테마로 묶어 한 화면에. 3국에서 동시 가동되는 테마를 찾고, 종목 클릭으로 주차별 RS 추이를 확인하세요.",
};

const MARKET_LABEL: Record<RsMarket, string> = { KR: "한국", US: "미국", JP: "일본" };
const MARKET_FLAG: Record<RsMarket, string> = { KR: "KR", US: "US", JP: "JP" };

function StockRow({ s }: { s: GlobalThemeStock }) {
  const display = s.name_en || s.name || s.ticker;
  const subTicker =
    s.market === "JP" ? s.ticker.replace(".T", "") : s.ticker;
  return (
    <li className="flex items-baseline justify-between gap-2 text-xs">
      <Link
        href={`/rs96/${s.market}/${encodeURIComponent(s.ticker)}`}
        className="min-w-0 flex-1 truncate text-textc hover:text-accent"
        title={display}
      >
        {display}
        <span className="ml-1 text-[10px] text-muted">{subTicker}</span>
      </Link>
      <span className="tnum font-semibold text-accent">{s.rs}</span>
    </li>
  );
}

function MarketColumn({
  market,
  stocks,
}: {
  market: RsMarket;
  stocks: GlobalThemeStock[];
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted">
        <span className="font-semibold">{MARKET_FLAG[market]}</span>
        <span>{stocks.length}</span>
      </div>
      {stocks.length === 0 ? (
        <p className="text-[11px] text-muted">—</p>
      ) : (
        <ul className="space-y-0.5">
          {stocks.slice(0, 8).map((s) => (
            <StockRow key={`${s.market}-${s.ticker}`} s={s} />
          ))}
          {stocks.length > 8 && (
            <li className="text-[10px] text-muted">+{stocks.length - 8}</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default async function GlobalThemes() {
  const data = await loadGlobalThemes();
  const { groups, weeks, totals, unmatched } = data;

  const noData = Object.values(weeks).every((w) => !w);

  return (
    <>
      <h1 className="mb-1 text-lg font-bold">한미일 모멘텀 테마</h1>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        3개 시장의 RS96+ 종목을 Gemini 가 분류한 테마로 묶어 한 화면에. <b className="text-textc">3국 동시</b> 가동되는 테마가 위쪽,
        총 종목 수 내림차순. 종목 클릭으로 주차별 RS 추이.
      </p>

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

      {noData ? (
        <Section title="데이터 없음">
          <Empty>아직 적재된 테마 데이터가 없습니다. 매주 자동 갱신됩니다.</Empty>
        </Section>
      ) : groups.length === 0 ? (
        <Section title="테마 없음">
          <Empty>이번 주차에 매핑된 테마가 없습니다.</Empty>
        </Section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <article
              key={g.key}
              className={`rounded-xl border bg-surface p-4 ${
                g.isGlobal
                  ? "border-accent/40"
                  : "border-[var(--color-borderc)]"
              }`}
            >
              <header className="mb-3 flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-textc">{g.label}</h3>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {g.isGlobal && (
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      3국 동시
                    </span>
                  )}
                  <span className="tnum text-[11px] text-muted">{g.total}</span>
                </div>
              </header>
              <div className="grid grid-cols-3 gap-3">
                <MarketColumn market="KR" stocks={g.byMarket.KR} />
                <MarketColumn market="US" stocks={g.byMarket.US} />
                <MarketColumn market="JP" stocks={g.byMarket.JP} />
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted">
        테마는 Gemini 가 시장별로 분류한 결과를 <b>이름 정규화</b>로 통합한 것입니다(예: &quot;AI 인프라&quot; ≈ &quot;AI infrastructure&quot;).
        시장별 분류 시점·기준이 미세하게 다를 수 있어 100% 정확한 통합은 아니며,
        같은 테마가 다른 이름으로 흩어져 있을 수 있습니다. 종목별 RS 시계열은 카드 안 종목명을 누르세요.
      </p>
    </>
  );
}
