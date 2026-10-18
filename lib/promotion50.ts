// RS 승격(+50%) 판정 — 21EMA 이탈이 매도 신호인지 가른다.
//
// [왜 필요한가]
//   RS 매도 규칙(SPEC_RS_CURRENT §6)은 단계가 둘이다.
//     · peak gain +20% 이상 → 21EMA 트레일 활성 (종가가 21EMA 이탈 시 청산)
//     · peak gain +50% 이상 → 50EMA 트레일이 21EMA 를 "대체" (승격 후 미복귀)
//   즉 ★승격한 종목은 21EMA 를 하회해도 팔지 않는다. 그런데 화면은 둘을
//   같은 "-" 로 보여줘서 "팔아야 하는가"를 가릴 수 없었다.
//
// [진입가를 무엇으로 잡나 — ★근사다]
//   /global 화면에는 RS 보유 원장이 연결돼 있지 않아 실제 진입가가 없다.
//   그래서 ★「그 종목이 RS96 에 올라온 연속 구간의 ★첫 주차 종가」를 진입가로 쓴다.
//   RS 는 "새로 올라온 주도주를 다음 주 시가에 산다"이므로 그 주차가 진입 시점에 가깝다.
//
//   ⚠️★이것은 근사이고 ★다음 둘이 실제와 어긋난다:
//     ① 쿨다운(8주)·M필터·영업이익/거래대금 게이트 때문에 ★실제로는 안 산 종목도 포함된다
//     ② 진입은 ★다음 주 시가인데 여기서는 ★그 주차 종가를 쓴다(한 주 빠르고 종가/시가 차이)
//   ⇒ ★매도 판단의 ★보조 표시이지 ★원장이 아니다.

import { supabase } from "@/lib/supabase";
import type { RsMarket } from "@/lib/types";

/** 연속 등재 구간을 거슬러 올라갈 최대 주차 수. */
const LOOKBACK_WEEKS = 60;
/** Supabase 한 번 응답의 행 상한 — 넘으면 끊겨서 조용히 모자란다. */
const PAGE = 1000;
/** 승격 문턱 — SPEC_RS_CURRENT §6 의 +50%. */
const PROMOTE_GAIN = 0.5;
/**
 * ⚠️★재량: 주차 사이가 이 일수 이내면 "연속 등재"로 본다.
 * 7일이 정상이고 14일은 한 주 결손을 견디기 위한 여유다.
 * 재진입 쿨다운이 8주(56일)라 14일로는 ★재진입을 연속으로 오인하지 않는다.
 */
const GAP_TOLERANCE_DAYS = 14;

export type PromotionMap = Map<string, boolean>;

export const promoKey = (market: RsMarket, ticker: string) => `${market}-${ticker}`;

interface WeekClose {
  ticker: string;
  week_date: string;
  close: number | null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function shiftWeeks(week: string, n: number): string {
  const d = new Date(`${week}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n * 7);
  return d.toISOString().slice(0, 10);
}

/** 한 시장의 최근 LOOKBACK_WEEKS 주차를 페이징으로 모두 가져온다. */
async function fetchMarketWindow(market: RsMarket, week: string): Promise<WeekClose[]> {
  const since = shiftWeeks(week, LOOKBACK_WEEKS);
  const out: WeekClose[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await supabase
      .from("rs_top_weekly")
      .select("ticker,week_date,close")
      .eq("market", market)
      .gte("week_date", since)
      .lte("week_date", week)
      .order("week_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (r.error) break;
    const rows = (r.data as WeekClose[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * 티커별로 ★현재 주차에서 거슬러 올라간 연속 등재 구간을 찾아
 * (구간 내 최고 종가 / 구간 첫 주차 종가 − 1) >= +50% 이면 승격으로 본다.
 */
function judge(rows: WeekClose[], week: string): Map<string, boolean> {
  const byTicker = new Map<string, WeekClose[]>();
  for (const r of rows) {
    if (r.close == null) continue;
    const a = byTicker.get(r.ticker);
    if (a) a.push(r);
    else byTicker.set(r.ticker, [r]);
  }

  const out = new Map<string, boolean>();
  for (const [ticker, list] of byTicker) {
    list.sort((a, b) => (a.week_date < b.week_date ? -1 : 1));
    // ★이번 주차에 없는 종목은 판정하지 않는다(화면에 안 나온다).
    if (list[list.length - 1].week_date !== week) continue;

    // 최신에서 역으로 — 간격이 벌어지는 지점이 연속 구간의 시작이다.
    let start = list.length - 1;
    while (start > 0) {
      const gap = daysBetween(list[start - 1].week_date, list[start].week_date);
      if (gap > GAP_TOLERANCE_DAYS) break;
      start -= 1;
    }

    const entry = list[start].close as number;
    if (!(entry > 0)) continue;
    let peak = entry;
    for (let i = start; i < list.length; i += 1) {
      const c = list[i].close as number;
      if (c > peak) peak = c;
    }
    out.set(ticker, peak / entry - 1 >= PROMOTE_GAIN);
  }
  return out;
}

/**
 * 그 주차 화면에 나오는 전 종목의 승격 여부.
 * 조회가 실패해도 화면은 살아야 하므로 ★빈 맵을 돌려준다(그러면 종전 표시 그대로).
 */
export async function fetchPromotion50(
  week: string,
  markets: RsMarket[] = ["KR", "US", "JP"],
): Promise<PromotionMap> {
  const out: PromotionMap = new Map();
  try {
    const per = await Promise.all(
      markets.map(async (m) => ({ market: m, rows: await fetchMarketWindow(m, week) })),
    );
    for (const { market, rows } of per) {
      for (const [ticker, promoted] of judge(rows, week)) {
        out.set(promoKey(market, ticker), promoted);
      }
    }
  } catch {
    return out;
  }
  return out;
}
