// 한미일 통합 테마 어그리게이션.
// rs_theme_weekly 가 시장(KR/US/JP)별로 따로 저장돼 있으므로,
// 각 시장의 최신 주차 테마를 fetch → big 이름 정규화 → 같은 테마로 묶는다.

import { supabase } from "@/lib/supabase";
import type { RsMarket, RsThemeWeekly, RsTopWeekly } from "@/lib/types";

const MARKETS: RsMarket[] = ["KR", "US", "JP"];

export interface GlobalThemeStock {
  market: RsMarket;
  ticker: string;
  name: string | null;
  name_en: string | null;
  rs: number;
  rank_in_week: number;
  small?: string | null;
}

export interface GlobalThemeGroup {
  /** 표시용 테마명 (가장 자주 등장한 big 의 원형) */
  label: string;
  /** 정규화 키 (병합 기준) */
  key: string;
  byMarket: Record<RsMarket, GlobalThemeStock[]>;
  total: number;
  /** 3국 모두 등장 여부 */
  isGlobal: boolean;
}

export interface GlobalThemeData {
  groups: GlobalThemeGroup[];
  /** 시장별 최신 주차 */
  weeks: Record<RsMarket, string | null>;
  /** 시장별 미분류(테마에 매핑 안 됨) 종목 수 */
  unmatched: Record<RsMarket, number>;
  /** 시장별 RS96+ 총 종목 수 */
  totals: Record<RsMarket, number>;
}

/** 정규화: 대소문자·공백·일부 특수문자 제거 + 흔한 동의어를 한 표현으로. */
function normalizeBig(s: string): string {
  let v = s.trim().toLowerCase();
  // 공백/하이픈/슬래시 제거
  v = v.replace(/[\s\-_/·、]+/g, "");
  // 동의어 통일 — 같은 테마가 시장마다 미세하게 다르게 적힐 때
  const replacements: [RegExp, string][] = [
    [/ai인프라(스트럭처)?/g, "ai인프라"],
    [/ai반도체/g, "ai반도체"],
    [/반도체장비/g, "반도체장비"],
    [/데이터센터/g, "데이터센터"],
    [/원자력|원전/g, "원자력"],
    [/전력|전기인프라/g, "전력인프라"],
    [/방위산업|국방|방산/g, "방위산업"],
    [/조선|해운/g, "조선해운"],
    [/2차전지|배터리/g, "2차전지"],
    [/바이오|제약/g, "바이오"],
    [/로봇|로보틱스/g, "로봇"],
    [/우주|항공우주/g, "우주항공"],
  ];
  for (const [re, rep] of replacements) v = v.replace(re, rep);
  return v;
}

export async function loadGlobalThemes(): Promise<GlobalThemeData> {
  // 시장별 최신 주차 1건씩만
  const themePromises = MARKETS.map(async (m) => {
    const r = await supabase
      .from("rs_theme_weekly")
      .select("*")
      .eq("market", m)
      .order("week_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { market: m, theme: (r.data as RsThemeWeekly | null) ?? null };
  });
  const themes = await Promise.all(themePromises);

  // 각 시장의 해당 주차 종목 row 도 fetch (name, rs, rank)
  const rowPromises = themes.map(async ({ market, theme }) => {
    if (!theme) return { market, rows: [] as RsTopWeekly[] };
    const r = await supabase
      .from("rs_top_weekly")
      .select("*")
      .eq("market", market)
      .eq("week_date", theme.week_date)
      .order("rank_in_week", { ascending: true });
    return { market, rows: (r.data as RsTopWeekly[]) ?? [] };
  });
  const marketRows = await Promise.all(rowPromises);
  const rowMap = new Map(marketRows.map((mr) => [mr.market, mr.rows]));

  const weeks: Record<RsMarket, string | null> = { KR: null, US: null, JP: null };
  const totals: Record<RsMarket, number> = { KR: 0, US: 0, JP: 0 };
  const unmatched: Record<RsMarket, number> = { KR: 0, US: 0, JP: 0 };

  // 정규화 키 → 그룹 누적
  const groupMap = new Map<string, GlobalThemeGroup>();
  // 라벨 빈도 (같은 키에 매핑된 원형 중 어느 것을 표시할지)
  const labelCount = new Map<string, Map<string, number>>();

  for (const { market, theme } of themes) {
    if (!theme) continue;
    weeks[market] = theme.week_date;
    const rows = rowMap.get(market) ?? [];
    totals[market] = rows.length;
    const rowByTk = new Map(rows.map((r) => [r.ticker, r]));
    const matchedTickers = new Set<string>();

    for (const cat of theme.categories) {
      const key = normalizeBig(cat.big);
      if (!key) continue;
      let g = groupMap.get(key);
      if (!g) {
        g = {
          label: cat.big,
          key,
          byMarket: { KR: [], US: [], JP: [] },
          total: 0,
          isGlobal: false,
        };
        groupMap.set(key, g);
        labelCount.set(key, new Map());
      }
      const lc = labelCount.get(key)!;
      lc.set(cat.big, (lc.get(cat.big) ?? 0) + 1);

      for (const tk of cat.tickers) {
        const r = rowByTk.get(tk);
        if (!r) continue;
        matchedTickers.add(tk);
        g.byMarket[market].push({
          market,
          ticker: tk,
          name: r.name,
          name_en: r.name_en,
          rs: r.rs,
          rank_in_week: r.rank_in_week,
          small: cat.small ?? undefined,
        });
        g.total += 1;
      }
    }

    unmatched[market] = rows.length - matchedTickers.size;
  }

  // 라벨 결정 (각 그룹에서 가장 자주 쓰인 big 원형 채택)
  for (const [key, g] of groupMap) {
    const lc = labelCount.get(key);
    if (lc) {
      let best = "", bestN = -1;
      for (const [lbl, n] of lc) if (n > bestN) { best = lbl; bestN = n; }
      g.label = best || g.label;
    }
    // 각 시장 내 RS 내림차순 정렬
    for (const m of MARKETS) {
      g.byMarket[m].sort((a, b) => b.rs - a.rs || a.rank_in_week - b.rank_in_week);
    }
    g.isGlobal = MARKETS.every((m) => g.byMarket[m].length > 0);
  }

  // 그룹 정렬: 3국 동시 가동 → 총 종목 수 내림차순
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1;
    return b.total - a.total;
  });

  return { groups, weeks, totals, unmatched };
}
