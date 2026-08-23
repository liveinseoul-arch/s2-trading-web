// 연도별 성과 — ★운영 nav_daily 에서 계산한다(백테스트 스냅샷이 아니다).
//
// ⚠️★★왜 바꿨나 (2026-08-23 · 해달별님 지적)
//   처음에는 canonical 백테스트 스냅샷(무차입 · 과밀맵 off · CA=1)을 썼는데,
//   ★2026 연내 MDD 가 −4.10% 로 나왔다. 해달별님이 「2026-07 은 −14% 선이었다」고 지적했고,
//   ★운영 nav_daily 로 재니 ★−17.80%(저점 2026-07-08)였다.
//   ★★세계가 달랐다 — 웹앱의 다른 모든 페이지는 ★운영 세계(lev 1.2 · 운영 env 전량 ·
//   과밀맵 on · 실제 자본)를 보여주는데 그 한 자리만 canonical 이었다.
//   ★한 화면에 두 세계를 섞으면 오독한다(CLAUDE.md §2 · §7-1 이 반복 경고하는 것).
//
// ★부수 이득 — nav_daily 는 EOD 마다 갱신되므로 ★성과도 매일 자동으로 따라온다.
//   종전 방식은 백테스트 1런(약 65초)이 필요했고 ★2026 홀드아웃을 매일 여는 모양이었다(§4-4).
//
// [구현 정의 — 두 수치의 뜻]
//  · 연 수익률 = 그 해 마지막 NAV ÷ ★직전 해 마지막 NAV − 1.
//      한 해짜리라 CAGR 과 같은 값이다. 첫 해는 그 해 첫 NAV 가 기준이라 부분 연도다.
//  · 연내 MDD = ★그 해 안에서만 고점을 잡아 잰 최대 낙폭.
//      ⚠️전 구간 MDD 와 다르다 — 해를 넘는 낙폭은 안 잡힌다.
import { createClient } from "@supabase/supabase-js";

export interface YearPerf {
  year: number;
  retPct: number | null;
  mddPct: number;
  mddDate: string;
  days: number;
  partial: boolean;
}

export interface YearPerfResult {
  years: Record<string, YearPerf>;
  /** 날짜 → 그날 레버·보유 종목 수. ★nav_daily 를 이미 읽으므로 추가 비용이 없다. */
  daily: Record<string, { lev: number; nPos: number }>;
  first: string;
  last: string;
  rows: number;
}

/** nav_daily 전량을 읽어 연도별로 접는다. PostgREST 는 1,000행씩 준다. */
export async function yearPerf(fromYear: number): Promise<YearPerfResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";
  if (!url || !key) return { years: {}, daily: {}, first: "", last: "", rows: 0 };

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const all: Array<{ d: string; nav: number; leverage: number; n_positions: number }> = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("nav_daily")
      .select("d,nav,leverage,n_positions")
      .order("d", { ascending: true })
      .range(off, off + 999);
    if (error || !data?.length) break;
    all.push(...(data as unknown as Array<{ d: string; nav: number; leverage: number; n_positions: number }>));
    if (data.length < 1000) break;
  }
  if (!all.length) return { years: {}, daily: {}, first: "", last: "", rows: 0 };

  const daily: Record<string, { lev: number; nPos: number }> = {};
  for (const r of all) daily[r.d] = { lev: Number(r.leverage), nPos: Number(r.n_positions) };

  const byYear = new Map<number, Array<{ d: string; nav: number }>>();
  for (const r of all) {
    const y = +r.d.slice(0, 4);
    const arr = byYear.get(y) ?? [];
    arr.push(r);
    byYear.set(y, arr);
  }

  const years: Record<string, YearPerf> = {};
  let prevEnd: number | null = null;
  for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
    const v = byYear.get(y)!;
    if (y < fromYear) {
      prevEnd = v[v.length - 1].nav; // ★기준만 물려주고 표에는 안 넣는다
      continue;
    }
    const base = prevEnd ?? v[0].nav;
    // ★연내 고점만 쓴다 — 해를 넘는 낙폭은 일부러 안 잡는다
    let peak = -Infinity;
    let mdd = 0;
    let mddDate = v[0].d;
    for (const r of v) {
      peak = Math.max(peak, r.nav);
      const dd = r.nav / peak - 1;
      if (dd < mdd) {
        mdd = dd;
        mddDate = r.d;
      }
    }
    years[String(y)] = {
      year: y,
      retPct: base ? (v[v.length - 1].nav / base - 1) * 100 : null,
      mddPct: mdd * 100,
      mddDate,
      days: v.length,
      partial: prevEnd === null,
    };
    prevEnd = v[v.length - 1].nav;
  }
  return { years, daily, first: all[0].d, last: all[all.length - 1].d, rows: all.length };
}
