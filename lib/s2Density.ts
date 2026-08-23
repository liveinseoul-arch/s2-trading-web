// S2 진입 후보 밀도 — ★운영 Supabase `s2_density` 에서 읽는다(정적 JSON 아님).
//
// ⚠️★★2026-08-23 해달별님 요청으로 바꿨다 — 「과밀田 페이지가 ★일별로 갱신되도록
//   스케줄러에 포함되었으면 한다」. ★A안(정적 JSON + 매일 자동 커밋·push)과
//   ★B안(Supabase 적재 + 동적 페이지) 중 ★B를 골랐다:
//     ★매일 무인 push 는 되돌리기 어려운 외부 행위를 반복하고,
//     ★실패해도 화면만 낡아 ★조용한 실패가 된다(그날 그 유형 사고 2건).
//   ★채우는 쪽 — s2-trading-web/scripts/export_density.py (run_eod.ps1 단계).
//
// ★구현 정의 — 「후보 1건」
//   그날 ①MA20 이 있고 ②최근 20일 최대 거래대금 ≥ 5,000억 ③종가 < MA20 × 0.80 인 ★종목-일.
//   update_env_density.py:build() 의 dens 와 같은 식이다
//   (익스포터가 그 모듈에서 ★상수째 import 하므로 정의가 어긋날 수 없다).
// ★「과밀일」
//   위 건수의 15거래일 롤링 합(t−1 까지)이 확장창 상위 TOPQ(=0.0425)를 넘는 날.
//   그날은 진입 문턱이 0.20 → 0.15 로 완화된다(2026-08-22 채택).
import { createClient } from "@supabase/supabase-js";

export interface DensityMeta {
  first: string;
  last: string;
  days: number;
  zeroDays: number;
  crowdedDays: number;
  totalN: number;
  maxN: number;
  firstYear: number;
}

/** 한 해의 셀 하나. col=주(0부터), row=요일(월0…금4). */
export interface Cell {
  col: number;
  row: number;
  date: string;
  n: number;
  crowded: boolean;
  /** 15거래일 롤링 합. 워밍업 구간은 -1 */
  roll: number;
  /** 그날의 과밀 문턱. 워밍업 구간은 -1 */
  thr: number;
}

export interface YearGrid {
  year: number;
  cols: number;
  cells: Cell[];
  total: number;
  hitDays: number;
  maxN: number;
  crowdedDays: number;
}

export interface DensityResult {
  meta: DensityMeta;
  grids: YearGrid[];
}

const MS = 86400000;

function dayOfYear(iso: string): number {
  const y = +iso.slice(0, 4);
  const t = Date.UTC(y, +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((t - Date.UTC(y, 0, 1)) / MS) + 1;
}

/** 월=0 … 일=6 */
function weekday(iso: string): number {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return (d.getUTCDay() + 6) % 7;
}

/** 그 해 1월 1일이 무슨 요일인지에 맞춰 주(열) 번호를 낸다. */
export function colOf(iso: string): number {
  const y = +iso.slice(0, 4);
  const w0 = (new Date(Date.UTC(y, 0, 1)).getUTCDay() + 6) % 7;
  return Math.floor((dayOfYear(iso) - 1 + w0) / 7);
}

/** 그 해가 몇 주(열)인지 — 12월 31일 기준이라 연말이 안 잘린다. */
export function colsInYear(y: number): number {
  const w0 = (new Date(Date.UTC(y, 0, 1)).getUTCDay() + 6) % 7;
  return Math.floor((dayOfYear(`${y}-12-31`) - 1 + w0) / 7) + 1;
}

type Row = { d: string; n: number; crowded: boolean; roll15: number | null; thr: number | null };

const EMPTY: DensityResult = {
  meta: { first: "", last: "", days: 0, zeroDays: 0, crowdedDays: 0, totalN: 0, maxN: 0, firstYear: 0 },
  grids: [],
};

/** 연도별 격자 — 최근 연도가 앞(역순). */
export async function densityGrids(): Promise<DensityResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";
  if (!url || !key) return EMPTY;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ★PostgREST 는 1,000행씩 준다 — 다 받을 때까지 돈다.
  const rows: Row[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("s2_density")
      .select("d,n,crowded,roll15,thr")
      .order("d", { ascending: true })
      .range(off, off + 999);
    if (error || !data?.length) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  if (!rows.length) return EMPTY;

  const by = new Map<number, Cell[]>();
  for (const r of rows) {
    const y = +r.d.slice(0, 4);
    const arr = by.get(y) ?? [];
    arr.push({
      col: colOf(r.d),
      row: weekday(r.d),
      date: r.d,
      n: r.n,
      crowded: r.crowded,
      roll: r.roll15 ?? -1,
      thr: r.thr ?? -1,
    });
    by.set(y, arr);
  }

  const grids: YearGrid[] = [...by.keys()]
    .sort((a, b) => b - a)
    .map((year) => {
      const cells = by.get(year)!;
      return {
        year,
        cols: colsInYear(year),
        cells,
        total: cells.reduce((s, x) => s + x.n, 0),
        hitDays: cells.filter((x) => x.n > 0).length,
        maxN: cells.reduce((m, x) => Math.max(m, x.n), 0),
        crowdedDays: cells.filter((x) => x.crowded).length,
      };
    });

  return {
    meta: {
      first: rows[0].d,
      last: rows[rows.length - 1].d,
      days: rows.length,
      zeroDays: rows.filter((r) => r.n === 0).length,
      crowdedDays: rows.filter((r) => r.crowded).length,
      totalN: rows.reduce((s, r) => s + r.n, 0),
      maxN: rows.reduce((m, r) => Math.max(m, r.n), 0),
      firstYear: +rows[0].d.slice(0, 4),
    },
    grids,
  };
}

/**
 * 로그 구간 — 0건인 날이 73%라 선형으로 칠하면 거의 다 같은 색이 된다.
 * 실제 분포도 로그에 가깝다: 1건 67.3% · 2건 20.1% · 3–4건 8.1% · 5–8건 3.4% · 9+ 1.2%.
 */
export const LOG_BINS: Array<[number, number, string]> = [
  [1, 1, "1"],
  [2, 2, "2"],
  [3, 4, "3–4"],
  [5, 8, "5–8"],
  [9, Infinity, "9+"],
];

export function levelOf(n: number): number {
  if (n <= 0) return 0;
  for (let i = 0; i < LOG_BINS.length; i++) {
    if (n >= LOG_BINS[i][0] && n <= LOG_BINS[i][1]) return i + 1;
  }
  return 5;
}

export const WD = ["월", "화", "수", "목", "금"];

/** 진입 문턱 — 화면 각주용(익스포터가 쓰는 값과 같아야 한다). */
export const DEFN = { ma: 20, tvMinEok: 5000, baseEp: 0.2, win: 15, topq: 0.0425, relax: 0.15 };
