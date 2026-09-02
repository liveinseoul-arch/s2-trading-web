// RS96+ 전략 성과 (KR, 백테스트 스냅샷) — 앱 내장 정적 데이터.
// 생성: quant_infra RS 엔진(17_88_cmp_sf1) 백테스트 → scratchpad/make_rs96_json.py.
// 갱신 시 rs96Perf.json 재생성 후 커밋(라이브 데이터 아님, 주기적 스냅샷).
import raw from "./rs96Perf.json";

// ★capw 계열은 ★optional 이다 — ★2026-09-02 신설(Vercel 4일 정지 사고).
//   ★JSON 생성기가 두 벌이라(개발용 scripts/make_rs96_json.py · ★운영용
//   ★C:/quantBacktest/build_kr_perf_json.py) ★한쪽만 필드를 내던 시기가 있었고,
//   ★필수(required)로 두었더니 ★데이터 한 필드 결손이 ★빌드 전면 실패로 번져
//   ★2026-08-29 08:09 부터 ★커밋 15건이 배포되지 않았다.
//   ★표시 헬퍼(pct·signClass)가 null·undefined 를 "-" 로 처리하므로 ★UI 는 그대로 산다.
//   ⚠️★값을 채우는 책임은 ★생성기 쪽이다 — 여기서 optional 로 둔 것은
//   ★「값이 없다」를 허용한 것이지 ★「병기하지 않아도 된다」가 아니다(CLAUDE.md §3-6).
export interface RsPerfMeta {
  cagr: number; mdd: number; calmar: number; nTrades: number;
  winRate: number; avgRet: number; capwRet?: number | null; finalMult: number;
  start: string; end: string; base: number; config: string;
}
export interface RsPerfYear {
  year: number; ret: number; mdd: number; kospi: number | null; kosdaq: number | null;
  num: number; win: number; avg: number; capw?: number | null; pnl: number;
}
export interface RsPerfMonth {
  month: string; ret: number; mdd: number; num: number; win: number; avg: number; capw?: number | null; pnl: number;
}
export interface RsPerfTrade {
  ticker: string; name: string; entry: string; exit: string;
  entryPx: number; exitPx: number; retPct: number; pnl: number;
  days: number; reason: string; rs: number; ca: string;
}
export interface RsPerfHeld {
  ticker: string; name: string; entry: string;
  entryPx: number; close: number;
  evalPct: number; evalPnl: number;       // 누적(진입가 대비)
  mEvalPct: number; mEvalPnl: number;      // 이번달(전월말 대비)
  rs: number;
}

export const rs96Perf = raw as {
  meta: RsPerfMeta; yearly: RsPerfYear[]; monthly: RsPerfMonth[];
  trades: RsPerfTrade[]; held: Record<string, RsPerfHeld[]>;
};

// 티커(.KS/.KQ) → 6자리 코드 표시용
export const tickerCode = (t: string) => t.split(".")[0];

// 청산사유 → 표시 톤(이익=상승/손실=하락). 사유 문자열은 엔진 원본 유지.
export const reasonShort = (r: string) =>
  r.startsWith("손절") ? "손절"
    : r.startsWith("21EMA") ? "21EMA 이탈"
    : r.startsWith("50EMA") ? "50EMA 이탈"
    : r.startsWith("RS") ? "RS 하락" : r;
