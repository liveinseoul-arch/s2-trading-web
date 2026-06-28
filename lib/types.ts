// Supabase 테이블 행 타입 (docs/02-data-model 과 일치)

export type Market = "KS" | "KQ";

export interface NavDaily {
  d: string; nav: number; cash: number; stock_value: number;
  leverage: number; dd_pct: number; n_positions: number;
}

export interface PositionSnapshot {
  d: string; ticker: string; name: string; market: Market;
  entry_date: string; buy_count: number; sell_count: number; qty: number;
  avg_buy: number; last_close: number; eval_amount: number; eval_pnl: number;
  ret_pct: number; port_pct: number | null;
}

export interface DailyCandidate {
  d: string; ticker: string; kind: "new" | "add"; name: string; market: Market;
  current_price: number; order_price: number; port_pct: number;
  ma120_above: boolean; prev_spike_bull: boolean | null; stage: number;
  reached: boolean; drop_to_pct: number | null; snapshot_at: string;
}

export type ExecAction =
  | "buy_new" | "buy_add" | "sell_1" | "sell_2" | "sell_3" | "stop" | "newlow_stop";

export interface Execution {
  id: number; d: string; ticker: string; name: string; market: Market;
  action: ExecAction; stage: number | null; fill_price: number; qty: number;
  amount: number; port_pct: number | null; ma120_above: boolean | null;
  prev_spike_bull: boolean | null; blocked_by_leverage: boolean;
}

export type OrderType = "buy_add" | "sell" | "stop" | "newlow_stop";

export interface OrderPlan {
  id: number; d: string; ticker: string; name: string; market: Market;
  order_type: OrderType; stage: number | null; trigger_price: number;
  qty: number; port_pct: number | null;
  diff: "new" | "changed" | "keep" | "cancel"; note: string | null;
}

export interface Trade {
  id: number; ticker: string; name: string; market: Market;
  entry_date: string; exit_date: string | null; buy_count: number;
  max_invested: number; proceeds: number | null; pnl: number | null;
  ret_pct: number | null; holding_days: number | null;
  exit_reason: string | null; status: "open" | "closed";
}

export interface TradeLeg {
  id: number; trade_id: number; d: string; leg_type: string;
  stage: number | null; price: number; qty: number; amount: number;
  port_pct: number | null;
}

export interface DailyCount {
  d: string; n_candidates: number; n_reached: number; n_bought: number; n_blocked: number;
}

export interface MonthlyStat {
  month: string; num_trades: number; win_rate: number; avg_ret: number;
  realized_pnl: number; nav_start: number; nav_end: number;
  return_pct: number; mdd_pct: number;
}

export type RsMarket = "KR" | "US" | "JP";

export interface RsTopWeekly {
  market: RsMarket;
  week_date: string;
  ticker: string;
  name: string | null;          // 원어 (KR: 한글, US: 영문, JP: 일본어)
  name_en: string | null;       // 외국어 표기 (주로 JP — 영문 또는 한국어 번역)
  rs: number;
  comp_return: number | null;
  close: number | null;
  mktcap: number | null;        // KR=원, US=USD, JP=¥ (native currency)
  rank_in_week: number;
  align_weeks?: number | null;  // 주봉 정배열(4>13>26>52w) 부호 연속주수: 양수=N주 유지, 음수=N주 전 깨짐
  climax_warn?: boolean | null; // 클라이맥스/블로우오프 진입 주의 (최근 3주내)
}

export interface RsHistoryWeekly {
  market: RsMarket;
  ticker: string;
  week_date: string;
  rs: number;
  comp_return: number | null;
  close: number | null;
  align_weeks?: number | null;   // 부호 연속주수: 양수=정배열 N주 유지, 음수=N주 전 깨짐
  vol_gap_4_26?: number | null;  // 거래량 4주MA/26주MA-1(%). 음수=4w<26w 역배열(데드크로스)
}

export interface RsThemeCategory {
  big: string;
  small?: string | null;
  tickers: string[];
}

export interface RsThemeWeekly {
  market: RsMarket;
  week_date: string;
  summary: string | null;
  categories: RsThemeCategory[];
  model: string | null;
  generated_at: string;
}
