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
  comp_return: number | null;
  rank_in_week: number;
  small?: string | null;
}

export interface GlobalSubcategory {
  label: string;
  stocks: GlobalThemeStock[];
}

export interface GlobalThemeGroup {
  /** 표시용 테마명 (가장 자주 등장한 big 의 원형) */
  label: string;
  /** 정규화 키 (병합 기준) */
  key: string;
  byMarket: Record<RsMarket, GlobalThemeStock[]>;
  /** 시장 무관 RS desc → 52주 모멘텀 desc → rank asc 통합 정렬 리스트 */
  allStocks: GlobalThemeStock[];
  total: number;
  countByMarket: Record<RsMarket, number>;
  /** 3국 모두 등장 여부 */
  isGlobal: boolean;
  /** Gemini 가 50+ 테마를 서브카테고리로 세분 (있을 때만) */
  subcategories?: GlobalSubcategory[];
}

export interface GlobalThemeData {
  groups: GlobalThemeGroup[];
  /** 시장별 사용한 주차 */
  weeks: Record<RsMarket, string | null>;
  /** 시장별 미분류(테마에 매핑 안 됨) 종목 수 */
  unmatched: Record<RsMarket, number>;
  /** 시장별 RS96+ 총 종목 수 */
  totals: Record<RsMarket, number>;
  /** 시장별 Gemini 의 그 주차 시장 전반 summary (1~2문장) */
  marketSummaries: Record<RsMarket, string | null>;
}

/** 전 시장 합쳐 분류 가능한 주차 목록 (최신 → 과거). */
export async function fetchGlobalWeeks(): Promise<string[]> {
  const r = await supabase
    .from("rs_theme_weekly")
    .select("week_date")
    .order("week_date", { ascending: false });
  const rows = (r.data as { week_date: string }[]) ?? [];
  return Array.from(new Set(rows.map((x) => x.week_date)));
}

interface SubthemeRow {
  week_date: string;
  theme_key: string;
  theme_label: string;
  total_stocks: number;
  subcategories: { label: string; tickers: string[] }[];
}

async function fetchSubdivisions(weekDate: string): Promise<Map<string, SubthemeRow>> {
  const r = await supabase
    .from("rs_subtheme_global_weekly")
    .select("*")
    .eq("week_date", weekDate);
  // 테이블이 없을 경우(아직 마이그레이션 안 됨) 빈 맵으로 graceful fallback
  if (r.error) return new Map();
  const rows = (r.data as SubthemeRow[]) ?? [];
  return new Map(rows.map((x) => [x.theme_key, x]));
}

interface UnifiedThemeRow {
  week_date: string;
  summary: string | null;
  categories: { big: string; small?: string; tickers: string[] }[];
}

/** rs_global_theme_weekly (단일 호출 통합 분류) 로부터 groups 생성. 없으면 null. */
async function loadUnifiedGroups(
  week: string,
): Promise<{ groups: GlobalThemeGroup[]; summary: string | null } | null> {
  const u = await supabase
    .from("rs_global_theme_weekly")
    .select("*")
    .eq("week_date", week)
    .maybeSingle();
  if (u.error || !u.data) return null;
  const unified = u.data as UnifiedThemeRow;

  // 3개 시장의 rs_top_weekly fetch → ticker 메타 lookup
  const marketRowsPromises = MARKETS.map(async (m) => {
    const r = await supabase
      .from("rs_top_weekly")
      .select("*")
      .eq("market", m)
      .eq("week_date", week)
      .order("rank_in_week", { ascending: true });
    return { market: m, rows: (r.data as RsTopWeekly[]) ?? [] };
  });
  const marketRows = await Promise.all(marketRowsPromises);
  const tkLookup = new Map<string, { row: RsTopWeekly; market: RsMarket }>();
  for (const { market, rows } of marketRows) {
    for (const r of rows) tkLookup.set(r.ticker, { row: r, market });
  }

  const groups: GlobalThemeGroup[] = [];
  for (const cat of unified.categories) {
    const byMarket: Record<RsMarket, GlobalThemeStock[]> = { KR: [], US: [], JP: [] };
    for (const tk of cat.tickers) {
      const hit = tkLookup.get(tk);
      if (!hit) continue;
      byMarket[hit.market].push({
        market: hit.market,
        ticker: tk,
        name: hit.row.name,
        name_en: hit.row.name_en,
        rs: hit.row.rs,
        comp_return: hit.row.comp_return,
        rank_in_week: hit.row.rank_in_week,
        small: cat.small ?? undefined,
      });
    }
    const total = byMarket.KR.length + byMarket.US.length + byMarket.JP.length;
    if (total === 0) continue;

    const sortFn = (a: GlobalThemeStock, b: GlobalThemeStock) => {
      if (b.rs !== a.rs) return b.rs - a.rs;
      const ar = a.comp_return ?? -Infinity;
      const br = b.comp_return ?? -Infinity;
      if (br !== ar) return br - ar;
      return a.rank_in_week - b.rank_in_week;
    };
    for (const m of MARKETS) byMarket[m].sort(sortFn);
    const allStocks = [...byMarket.KR, ...byMarket.US, ...byMarket.JP].sort(sortFn);

    const countByMarket = {
      KR: byMarket.KR.length, US: byMarket.US.length, JP: byMarket.JP.length,
    };
    const isGlobal = countByMarket.KR > 0 && countByMarket.US > 0 && countByMarket.JP > 0;

    groups.push({
      label: cat.big,
      key: normalizeBig(cat.big),  // 같은 정규화 — subdivision 호환용
      byMarket,
      allStocks,
      total,
      countByMarket,
      isGlobal,
    });
  }

  groups.sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1;
    return b.total - a.total;
  });

  return { groups, summary: unified.summary };
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

export async function loadGlobalThemes(
  selectedWeek?: string | null,
): Promise<GlobalThemeData> {
  // selectedWeek 가 있으면 그 주차로 fetch (시장별로 동일 주차), 없으면 시장별 최신
  const themePromises = MARKETS.map(async (m) => {
    let q = supabase.from("rs_theme_weekly").select("*").eq("market", m);
    if (selectedWeek) {
      q = q.eq("week_date", selectedWeek);
    } else {
      q = q.order("week_date", { ascending: false }).limit(1);
    }
    const r = await q.maybeSingle();
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
  const marketSummaries: Record<RsMarket, string | null> = { KR: null, US: null, JP: null };

  // 정규화 키 → 그룹 누적
  const groupMap = new Map<string, GlobalThemeGroup>();
  // 라벨 빈도 (같은 키에 매핑된 원형 중 어느 것을 표시할지)
  const labelCount = new Map<string, Map<string, number>>();

  for (const { market, theme } of themes) {
    if (!theme) continue;
    weeks[market] = theme.week_date;
    marketSummaries[market] = theme.summary;
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
          allStocks: [],
          total: 0,
          countByMarket: { KR: 0, US: 0, JP: 0 },
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
          comp_return: r.comp_return,
          rank_in_week: r.rank_in_week,
          small: cat.small ?? undefined,
        });
        g.total += 1;
      }
    }

    unmatched[market] = rows.length - matchedTickers.size;
  }

  // 라벨 결정 + 통합 정렬 리스트 생성
  for (const [key, g] of groupMap) {
    const lc = labelCount.get(key);
    if (lc) {
      let best = "", bestN = -1;
      for (const [lbl, n] of lc) if (n > bestN) { best = lbl; bestN = n; }
      g.label = best || g.label;
    }
    // 시장 무관 통합: RS desc → comp_return desc → rank asc
    const all: GlobalThemeStock[] = [];
    for (const m of MARKETS) {
      g.countByMarket[m] = g.byMarket[m].length;
      all.push(...g.byMarket[m]);
    }
    all.sort((a, b) => {
      if (b.rs !== a.rs) return b.rs - a.rs;
      const ar = a.comp_return ?? -Infinity;
      const br = b.comp_return ?? -Infinity;
      if (br !== ar) return br - ar;
      return a.rank_in_week - b.rank_in_week;
    });
    g.allStocks = all;
    // 시장 내 정렬도 동일 기준 유지 (필요 시 사용)
    for (const m of MARKETS) {
      g.byMarket[m].sort((a, b) => {
        if (b.rs !== a.rs) return b.rs - a.rs;
        const ar = a.comp_return ?? -Infinity;
        const br = b.comp_return ?? -Infinity;
        if (br !== ar) return br - ar;
        return a.rank_in_week - b.rank_in_week;
      });
    }
    g.isGlobal = MARKETS.every((m) => g.byMarket[m].length > 0);
  }

  // 그룹 정렬: 3국 동시 가동 → 총 종목 수 내림차순
  let groups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1;
    return b.total - a.total;
  });

  // 통합 단일 호출 분류가 있으면 그것을 우선 사용 (라벨 일관성 보장)
  const subWeek = selectedWeek ?? Object.values(weeks).find((v) => v) ?? null;
  if (subWeek) {
    const unified = await loadUnifiedGroups(subWeek);
    if (unified && unified.groups.length > 0) {
      groups = unified.groups;
    }
  }

  // 50+ 테마 서브디비전 머지 (selectedWeek 기준)
  if (subWeek) {
    const subMap = await fetchSubdivisions(subWeek);
    for (const g of groups) {
      const sub = subMap.get(g.key);
      if (!sub) continue;
      const stockByTk = new Map(g.allStocks.map((s) => [s.ticker, s] as const));
      const used = new Set<string>();
      const subcategories: GlobalSubcategory[] = sub.subcategories.map((sc) => {
        const items: GlobalThemeStock[] = [];
        for (const tk of sc.tickers) {
          const s = stockByTk.get(tk);
          if (!s) continue;
          if (used.has(tk)) continue;
          used.add(tk);
          items.push(s);
        }
        items.sort((a, b) => {
          if (b.rs !== a.rs) return b.rs - a.rs;
          const ar = a.comp_return ?? -Infinity;
          const br = b.comp_return ?? -Infinity;
          if (br !== ar) return br - ar;
          return a.rank_in_week - b.rank_in_week;
        });
        return { label: sc.label, stocks: items };
      }).filter((s) => s.stocks.length > 0);

      // 누락된 종목은 "기타" 로 모아둠
      const leftover = g.allStocks.filter((s) => !used.has(s.ticker));
      if (leftover.length > 0) {
        subcategories.push({ label: "기타", stocks: leftover });
      }
      g.subcategories = subcategories;
    }
  }

  return { groups, weeks, totals, unmatched, marketSummaries };
}
