// S2 진입 후보 발생 밀도 — 앱 내장 정적 스냅샷(라이브 아님).
//
// 생성: s2_method/archive/_2026-08-23_export_density_grid.py  (일별 후보 수 + 과밀일)
//       s2_method/archive/_2026-08-23_yearly_perf.py          (연도별 수익률 · 연내 MDD)
//       두 산출을 archive/_2026-08-23_build_density_grass.py 계열 스크립트가 이 JSON 으로 합친다.
//
// 갱신 시 s2Density.json 재생성 후 커밋. canonical 스냅샷이라 최신일이 뒤처질 수 있다.
//
// ★구현 정의 — 「후보 1건」
//   그날 ①MA20 이 있고 ②최근 20일 최대 거래대금 ≥ 5,000억 ③종가 < MA20 × 0.80 인 **종목-일**.
//   update_env_density.py:build() 의 dens 와 같은 식(상수를 그 모듈에서 가져와 계산했다).
// ★「과밀일」
//   위 건수의 15거래일 롤링 합(t−1 까지)이 확장창 상위 TOPQ(=0.0425)를 넘는 날.
//   그날은 진입 문턱이 0.20 → 0.15 로 완화된다(2026-08-22 채택).
import raw from "./s2Density.json";

/** [날짜, 후보 수, 과밀(0|1), 15거래일 누적(-1=미정), 그날 문턱(-1=미정)] */
export type DensityRow = [string, number, number, number, number];

export interface DensityMeta {
  generated: string;
  first: string;
  last: string;
  days: number;
  zeroDays: number;
  crowdedDays: number;
  totalN: number;
  maxN: number;
  firstYear: number;
  db: string;
  defn: {
    ma: number;
    tv_min: number;
    base_ep: number;
    win: number;
    warm: number;
    topq: number;
    relax: number;
  };
}

export interface YearPerf {
  ret_pct: number | null;
  mdd_pct: number;
  mdd_date: string;
  nav_start: number;
  nav_end: number;
  days: number;
  partial: boolean;
}

export interface PerfMeta {
  generated: string;
  world: Record<string, unknown> & {
    db: string;
    envelope_pct: number;
    time_stop: number;
    max_lev: number;
    size: number[];
    crowd_map: string;
  };
  total: {
    cagr: number;
    mdd: number;
    calmar: number;
    trades: number;
    period_start: string;
    period_end: string;
  };
  defn: { ret: string; mdd: string };
}

export interface DensityData {
  meta: DensityMeta;
  perfMeta: PerfMeta;
  perf: Record<string, YearPerf>;
  d: DensityRow[];
}

export const density = raw as unknown as DensityData;

/** 한 해의 셀 하나. col=주(0부터), row=요일(월0…금4). */
export interface Cell {
  col: number;
  row: number;
  date: string;
  n: number;
  crowded: boolean;
  roll: number;
  thr: number;
}

export interface YearGrid {
  year: number;
  cols: number;
  cells: Cell[];
  /** 그 해 요약 */
  total: number;
  hitDays: number;
  maxN: number;
  crowdedDays: number;
}

const MS = 86400000;

function dayOfYear(iso: string): number {
  const y = +iso.slice(0, 4);
  const t = Date.UTC(y, +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((t - Date.UTC(y, 0, 1)) / MS) + 1;
}

/** 월=0 … 일=6 */
function weekday(iso: string): number {
  const d = new Date(
    Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)),
  );
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
  const last = `${y}-12-31`;
  return Math.floor((dayOfYear(last) - 1 + w0) / 7) + 1;
}

let _cache: YearGrid[] | null = null;

/** 연도별 격자 — 최근 연도가 앞(역순). */
export function yearGrids(): YearGrid[] {
  if (_cache) return _cache;
  const by = new Map<number, Cell[]>();
  for (const [date, n, c, roll, thr] of density.d) {
    const y = +date.slice(0, 4);
    const arr = by.get(y) ?? [];
    arr.push({
      col: colOf(date),
      row: weekday(date),
      date,
      n,
      crowded: c === 1,
      roll,
      thr,
    });
    by.set(y, arr);
  }
  _cache = [...by.keys()]
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
  return _cache;
}

/**
 * 로그 구간 — 0건인 날이 82%라 선형으로 칠하면 거의 다 같은 색이 된다.
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
