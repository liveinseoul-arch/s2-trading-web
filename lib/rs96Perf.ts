// RS96+ 전략 성과 (KR, 백테스트 스냅샷) — 앱 내장 정적 데이터.
// 생성: quant_infra RS 엔진(17_88_cmp_sf1) 백테스트 → scratchpad/make_rs96_json.py.
// 갱신 시 rs96Perf.json 재생성 후 커밋(라이브 데이터 아님, 주기적 스냅샷).
import raw from "./rs96Perf.json";

export interface RsPerfMeta {
  cagr: number; mdd: number; calmar: number; nTrades: number;
  winRate: number; avgRet: number; finalMult: number;
  start: string; end: string; base: number; config: string;
}
export interface RsPerfYear {
  year: number; ret: number; mdd: number; kospi: number | null; kosdaq: number | null;
  num: number; win: number; avg: number; pnl: number;
}
export interface RsPerfMonth {
  month: string; ret: number; mdd: number; num: number; win: number; avg: number; pnl: number;
}
export interface RsPerfTrade {
  ticker: string; name: string; entry: string; exit: string;
  entryPx: number; exitPx: number; retPct: number; pnl: number;
  days: number; reason: string; rs: number; ca: string;
}

export const rs96Perf = raw as {
  meta: RsPerfMeta; yearly: RsPerfYear[]; monthly: RsPerfMonth[]; trades: RsPerfTrade[];
};

// 청산사유 → 표시 톤(이익=상승/손실=하락). 사유 문자열은 엔진 원본 유지.
export const reasonShort = (r: string) =>
  r.startsWith("손절") ? "손절"
    : r.startsWith("21EMA") ? "21EMA 이탈"
    : r.startsWith("50EMA") ? "50EMA 이탈"
    : r.startsWith("RS") ? "RS 하락" : r;
