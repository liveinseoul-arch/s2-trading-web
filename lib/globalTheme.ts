// 한미일 통합 테마 어그리게이션.
// rs_theme_weekly 가 시장(KR/US/JP)별로 따로 저장돼 있으므로,
// 각 시장의 최신 주차 테마를 fetch → big 이름 정규화 → 같은 테마로 묶는다.

import { supabase } from "@/lib/supabase";
import type { RsMarket, RsThemeWeekly, RsTopWeekly } from "@/lib/types";

const MARKETS: RsMarket[] = ["KR", "US", "JP"];

/** 종가의 일봉 EMA 이탈 비트마스크. bit0(=1)=EMA21 하향, bit1(=2)=EMA50 하향.
 *  0=둘 다 위, 1=21만 아래, 2=50만 아래, 3=둘 다 아래. 값 없으면 null. */
function emaBreak(
  close: number | null | undefined,
  e21: number | null | undefined,
  e50: number | null | undefined,
): 0 | 1 | 2 | 3 | null {
  if (close == null || e21 == null || e50 == null) return null;
  let b = 0;
  if (close < e21) b |= 1;
  if (close < e50) b |= 2;
  return b as 0 | 1 | 2 | 3;
}

export interface GlobalThemeStock {
  market: RsMarket;
  ticker: string;
  name: string | null;
  name_en: string | null;
  rs: number;
  comp_return: number | null;
  rank_in_week: number;
  small?: string | null;
  /** 종가의 일봉 EMA 이탈 비트마스크: bit0=EMA21 하향, bit1=EMA50 하향 (0~3, null=데이터없음) */
  emaBreak?: 0 | 1 | 2 | 3 | null;
}

export interface GlobalSubcategory {
  label: string;
  stocks: GlobalThemeStock[];
  /** 4주전 대비 종목 수 변화 (세분은 라벨 변동이 커 티커 재분류 기준). null = 비교 불가 */
  deltaTotal?: number | null;
  /** 이번주 세분 종목 중 4주전에도 RS96+ 였던 수 */
  prevTotal?: number | null;
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
  /** 4주전 대비 총 종목 수 변화 (기준 주차 존재 시). null = 비교 불가 */
  deltaTotal?: number | null;
  /** 4주전 총 종목 수 (없던 테마면 0) */
  prevTotal?: number | null;
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
  /** 한미일 통합 단일 호출 Gemini 모델 (rs_global_theme_weekly.model) */
  unifiedModel: string | null;
  /** 50+ 테마 서브디비전 Gemini 모델 (있을 경우) */
  subdivisionModel: string | null;
  /** 델타 계산에 사용한 4주전 기준 주차 (없으면 null) */
  compareWeek: string | null;
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
  model?: string | null;
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
  model?: string | null;
}

/** rs_global_theme_weekly (단일 호출 통합 분류) 로부터 groups 생성. 없으면 null. */
async function loadUnifiedGroups(
  week: string,
): Promise<{ groups: GlobalThemeGroup[]; summary: string | null; model: string | null } | null> {
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

  // 같은 big(정규화 키)을 가진 카테고리들을 하나의 그룹으로 머지
  // — Gemini 가 big='반도체' 안에 small='장비/소재/IDM' 으로 나눠 보낸 경우,
  // 한 카드(반도체) 안에 small 들이 흩어진 종목으로 보이도록.
  const groupMap = new Map<string, GlobalThemeGroup>();
  const labelCount = new Map<string, Map<string, number>>();

  for (const cat of unified.categories) {
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
      const hit = tkLookup.get(tk);
      if (!hit) continue;
      g.byMarket[hit.market].push({
        market: hit.market,
        ticker: tk,
        name: hit.row.name,
        name_en: hit.row.name_en,
        rs: hit.row.rs,
        comp_return: hit.row.comp_return,
        rank_in_week: hit.row.rank_in_week,
        small: cat.small ?? undefined,
        emaBreak: emaBreak(hit.row.close, hit.row.ema_21, hit.row.ema_50),
      });
    }
  }

  // 그룹별 마무리 정렬·집계
  const sortFn = (a: GlobalThemeStock, b: GlobalThemeStock) => {
    if (b.rs !== a.rs) return b.rs - a.rs;
    const ar = a.comp_return ?? -Infinity;
    const br = b.comp_return ?? -Infinity;
    if (br !== ar) return br - ar;
    return a.rank_in_week - b.rank_in_week;
  };
  const groups: GlobalThemeGroup[] = [];
  for (const [key, g] of groupMap) {
    const lc = labelCount.get(key);
    if (lc) {
      let best = "", bestN = -1;
      for (const [lbl, n] of lc) if (n > bestN) { best = lbl; bestN = n; }
      g.label = best || g.label;
    }
    for (const m of MARKETS) {
      g.byMarket[m].sort(sortFn);
      g.countByMarket[m] = g.byMarket[m].length;
    }
    g.total = g.countByMarket.KR + g.countByMarket.US + g.countByMarket.JP;
    if (g.total === 0) continue;
    g.allStocks = [...g.byMarket.KR, ...g.byMarket.US, ...g.byMarket.JP].sort(sortFn);
    g.isGlobal = g.countByMarket.KR > 0 && g.countByMarket.US > 0 && g.countByMarket.JP > 0;
    groups.push(g);
  }

  groups.sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1;
    return b.total - a.total;
  });

  return { groups, summary: unified.summary, model: unified.model ?? null };
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

/** 특정 주차의 테마 key→총종목수 맵 (delta 계산용).
 *  본 경로와 동일하게 통합분류(rs_global_theme_weekly) 우선, 없으면 시장별 머지 카운트. */
async function loadGroupTotalsForWeek(week: string): Promise<Map<string, number>> {
  const unified = await loadUnifiedGroups(week);
  if (unified && unified.groups.length > 0) {
    return new Map(unified.groups.map((g) => [g.key, g.total]));
  }
  const themePromises = MARKETS.map(async (m) => {
    const r = await supabase
      .from("rs_theme_weekly")
      .select("*")
      .eq("market", m)
      .eq("week_date", week)
      .maybeSingle();
    return { market: m, theme: (r.data as RsThemeWeekly | null) ?? null };
  });
  const themes = await Promise.all(themePromises);
  const validPromises = themes.map(async ({ market, theme }) => {
    if (!theme) return { market, valid: new Set<string>() };
    const r = await supabase
      .from("rs_top_weekly")
      .select("ticker")
      .eq("market", market)
      .eq("week_date", theme.week_date);
    const rows = (r.data as { ticker: string }[]) ?? [];
    return { market, valid: new Set(rows.map((x) => x.ticker)) };
  });
  const validList = await Promise.all(validPromises);
  const validByMarket = new Map(validList.map((v) => [v.market, v.valid]));

  const totalByKey = new Map<string, number>();
  for (const { market, theme } of themes) {
    if (!theme) continue;
    const valid = validByMarket.get(market) ?? new Set<string>();
    for (const cat of theme.categories) {
      const key = normalizeBig(cat.big);
      if (!key) continue;
      let n = 0;
      for (const tk of cat.tickers) if (valid.has(tk)) n++;
      totalByKey.set(key, (totalByKey.get(key) ?? 0) + n);
    }
  }
  return totalByKey;
}

/** 해당 주차의 RS96+ 유니버스(rs_top_weekly 전 종목 티커 집합). */
async function fetchRsUniverse(week: string): Promise<Set<string>> {
  const rows = await Promise.all(
    MARKETS.map(async (m) => {
      const r = await supabase
        .from("rs_top_weekly")
        .select("ticker")
        .eq("market", m)
        .eq("week_date", week);
      return (r.data as { ticker: string }[]) ?? [];
    }),
  );
  return new Set(rows.flat().map((x) => x.ticker));
}

/** 통합분류(rs_global_theme_weekly)가 존재하는 주차 집합. */
async function fetchUnifiedWeeks(): Promise<Set<string>> {
  const r = await supabase.from("rs_global_theme_weekly").select("week_date");
  const rows = (r.data as { week_date: string }[]) ?? [];
  return new Set(rows.map((x) => x.week_date));
}

/** primary 주차 기준 ~28일 전(4주전, 18~38일 창) 에서 비교 기준 주차 선택.
 *  현재 주차가 통합분류를 쓰면 비교도 통합분류 주차로 맞춘다(라벨 어휘 일치 → 델타 왜곡 방지).
 *  창 안에 후보가 없으면 null → 델타 미표시. */
function pickCompareWeek(
  primary: string,
  availWeeks: string[],
  unifiedWeeks: Set<string>,
  preferUnified: boolean,
): string | null {
  const pT = Date.parse(primary);
  const target = pT - 28 * 86400000;
  const cand = availWeeks.filter((w) => {
    const t = Date.parse(w);
    if (t >= pT) return false; // 과거 주차만
    const days = Math.round((pT - t) / 86400000);
    return days >= 18 && days <= 38;
  });
  if (cand.length === 0) return null;
  let pool = cand;
  if (preferUnified) {
    const uni = cand.filter((w) => unifiedWeeks.has(w));
    if (uni.length > 0) pool = uni; // 통합분류 주차만 사용(어휘 일치)
  }
  pool.sort((a, b) => {
    const da = Math.abs(Date.parse(a) - target);
    const db = Math.abs(Date.parse(b) - target);
    if (da !== db) return da - db; // 28일에 가장 가까운 순
    return Date.parse(b) - Date.parse(a); // 동률이면 더 최근
  });
  return pool[0];
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
          emaBreak: emaBreak(r.close, r.ema_21, r.ema_50),
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
  let unifiedModel: string | null = null;
  let subdivisionModel: string | null = null;
  if (subWeek) {
    const unified = await loadUnifiedGroups(subWeek);
    if (unified && unified.groups.length > 0) {
      groups = unified.groups;
      unifiedModel = unified.model;
    }
  }

  // 50+ 테마 서브디비전 머지 (selectedWeek 기준)
  if (subWeek) {
    const subMap = await fetchSubdivisions(subWeek);
    for (const sub of subMap.values()) {
      if (sub.model) { subdivisionModel = sub.model; break; }
    }
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

  // 4주전 대비 총 종목 수 변화 (테마 key 기준)
  let compareWeek: string | null = null;
  if (subWeek) {
    const [availWeeks, unifiedWeeks] = await Promise.all([
      fetchGlobalWeeks(),
      fetchUnifiedWeeks(),
    ]);
    compareWeek = pickCompareWeek(subWeek, availWeeks, unifiedWeeks, unifiedModel != null);
    if (compareWeek) {
      const [prev, prevUniverse] = await Promise.all([
        loadGroupTotalsForWeek(compareWeek),
        fetchRsUniverse(compareWeek),
      ]);
      for (const g of groups) {
        const labelPrev = prev.get(g.key) ?? 0;
        if (labelPrev > 0) {
          // 4주전에도 같은 테마가 존재 → 그 주차 테마 종목 수로 비교(증·감 모두)
          g.prevTotal = labelPrev;
        } else {
          // 4주전 분류목록엔 없던 테마 → 그 테마의 이번주 종목 중 4주전에도
          // RS96+ 였던 수로 재계산(라벨 드리프트로 인한 허위 "신규" 방지)
          let c = 0;
          for (const s of g.allStocks) if (prevUniverse.has(s.ticker)) c++;
          g.prevTotal = c;
        }
        g.deltaTotal = g.total - g.prevTotal;

        // 세분(서브카테고리)은 라벨 변동이 커 항상 티커 재분류로 비교
        if (g.subcategories) {
          for (const sub of g.subcategories) {
            let c = 0;
            for (const s of sub.stocks) if (prevUniverse.has(s.ticker)) c++;
            sub.prevTotal = c;
            sub.deltaTotal = sub.stocks.length - c;
          }
        }
      }
    }
  }

  return {
    groups,
    weeks,
    totals,
    unmatched,
    marketSummaries,
    unifiedModel,
    subdivisionModel,
    compareWeek,
  };
}
