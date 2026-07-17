-- =====================================================================
-- S2 트레이딩 따라하기 · Supabase 스키마 (Phase 1)
-- Supabase SQL Editor에 붙여넣어 실행. 멱등(재실행 안전) 하도록 drop 후 생성.
-- 가격 = 원(KRW) bigint, 비율 = numeric, 시장 = 'KS'(KOSPI)/'KQ'(KOSDAQ).
-- 쓰기는 service_role(파이썬 익스포터)만, 읽기는 anon 공개(RLS).
-- =====================================================================

-- ── 정리(재실행 대비) ────────────────────────────────────────────────
drop table if exists trade_legs        cascade;
drop table if exists trades            cascade;
drop table if exists daily_order_plan  cascade;
drop table if exists daily_candidates  cascade;
drop table if exists executions        cascade;
drop table if exists position_snapshots cascade;
drop table if exists nav_daily         cascade;
drop table if exists monthly_stats     cascade;
drop table if exists meta              cascade;

-- ── 메타/설정 ────────────────────────────────────────────────────────
create table meta (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── 장마감 전 동시호가 후보 (15:10, Phase 2부터 적재) ────────────────
create table daily_candidates (
  d               date    not null,
  ticker          text    not null,
  kind            text    not null check (kind in ('new','add')),
  name            text    not null,
  market          text    not null check (market in ('KS','KQ')),
  current_price   bigint  not null,
  order_price     bigint  not null,
  port_pct        numeric(5,2) not null,
  ma120_above     boolean not null,
  prev_spike_bull boolean,
  stage           smallint not null default 1,
  reached         boolean not null,
  drop_to_pct     numeric(6,2),
  snapshot_at     timestamptz not null,
  primary key (d, ticker, kind)
);
create index daily_candidates_d_idx on daily_candidates (d);

-- ── 일일 감시주문 플랜 (마감 후 산출 → 다음 거래일 세팅) ─────────────
create table daily_order_plan (
  id            bigint generated always as identity primary key,
  d             date    not null,
  ticker        text    not null,
  name          text    not null,
  market        text    not null,
  order_type    text    not null check (order_type in ('buy_add','sell','stop','newlow_stop')),
  stage         smallint,
  trigger_price bigint  not null,
  qty           integer not null,
  port_pct      numeric(5,2),
  diff          text not null default 'keep' check (diff in ('new','changed','keep','cancel')),
  note          text,
  created_at    timestamptz not null default now()
);
create index daily_order_plan_d_idx        on daily_order_plan (d);
create index daily_order_plan_d_ticker_idx on daily_order_plan (d, ticker);

-- ── 사후 확정 체결/미체결 ────────────────────────────────────────────
create table executions (
  id            bigint generated always as identity primary key,
  d             date    not null,
  ticker        text    not null,
  name          text    not null,
  market        text    not null,
  action        text    not null check (action in
                  ('buy_new','buy_add','sell_1','sell_2','sell_3','stop','newlow_stop')),
  stage         smallint,
  fill_price    bigint  not null,
  qty           integer not null,
  amount        bigint  not null,
  port_pct      numeric(5,2),
  ma120_above   boolean,
  prev_spike_bull boolean,
  blocked_by_leverage boolean not null default false,
  created_at    timestamptz not null default now()
);
create index executions_d_idx      on executions (d);
create index executions_ticker_idx on executions (ticker);

-- ── 일자별 마감 후 보유 포트폴리오 ───────────────────────────────────
create table position_snapshots (
  d            date    not null,
  ticker       text    not null,
  name         text    not null,
  market       text    not null,
  entry_date   date    not null,
  buy_count    smallint not null,
  sell_count   smallint not null,
  qty          integer not null,
  avg_buy      bigint  not null,
  last_close   bigint  not null,
  eval_amount  bigint  not null,
  eval_pnl     bigint  not null,
  ret_pct      numeric(6,2) not null,
  port_pct     numeric(5,2),
  primary key (d, ticker)
);
create index position_snapshots_d_idx on position_snapshots (d);

-- ── 완결 라운드트립 거래 ─────────────────────────────────────────────
create table trades (
  id           bigint generated always as identity primary key,
  ticker       text    not null,
  name         text    not null,
  market       text    not null,
  entry_date   date    not null,
  exit_date    date,
  buy_count    smallint not null,
  max_invested bigint  not null,
  proceeds     bigint,
  pnl          bigint,
  ret_pct      numeric(7,2),
  holding_days integer,
  exit_reason  text,
  status       text not null default 'open' check (status in ('open','closed'))
);
create index trades_entry_idx  on trades (entry_date);
create index trades_exit_idx   on trades (exit_date);
create index trades_ticker_idx on trades (ticker);

-- ── 거래 레그(개별 매수/매도) ────────────────────────────────────────
create table trade_legs (
  id        bigint generated always as identity primary key,
  trade_id  bigint not null references trades(id) on delete cascade,
  d         date    not null,
  leg_type  text    not null,
  stage     smallint,
  price     bigint  not null,
  qty       integer not null,
  amount    bigint  not null,
  port_pct  numeric(5,2),
  hhmm      text            -- 분봉 복원 체결시각 'HH:MM' (2025+ 만, 크레온 캐시). 그외 null.
);
create index trade_legs_trade_idx on trade_legs (trade_id);
create index trade_legs_d_idx     on trade_legs (d);

-- ── 일별 NAV/낙폭 시계열 ─────────────────────────────────────────────
create table nav_daily (
  d           date primary key,
  nav         bigint  not null,
  cash        bigint  not null,
  stock_value bigint  not null,
  leverage    numeric(4,3) not null,
  dd_pct      numeric(6,2) not null,
  n_positions smallint not null
);

-- ── 월별 통계 ────────────────────────────────────────────────────────
create table monthly_stats (
  month        text primary key,          -- 'YYYY-MM'
  num_trades   integer not null,
  win_rate     numeric(5,2) not null,
  avg_ret      numeric(6,2) not null,
  realized_pnl bigint  not null,
  nav_start    bigint  not null,
  nav_end      bigint  not null,
  return_pct   numeric(7,2) not null,
  mdd_pct      numeric(6,2) not null
);

-- =====================================================================
-- RLS: 공개 읽기 전용. 쓰기는 service_role 키(RLS 우회)만.
-- =====================================================================
alter table meta                enable row level security;
alter table daily_candidates    enable row level security;
alter table daily_order_plan    enable row level security;
alter table executions          enable row level security;
alter table position_snapshots  enable row level security;
alter table trades              enable row level security;
alter table trade_legs          enable row level security;
alter table nav_daily           enable row level security;
alter table monthly_stats       enable row level security;

create policy "public read" on meta               for select using (true);
create policy "public read" on daily_candidates   for select using (true);
create policy "public read" on daily_order_plan    for select using (true);
create policy "public read" on executions          for select using (true);
create policy "public read" on position_snapshots  for select using (true);
create policy "public read" on trades              for select using (true);
create policy "public read" on trade_legs          for select using (true);
create policy "public read" on nav_daily           for select using (true);
create policy "public read" on monthly_stats       for select using (true);

-- ── seed ─────────────────────────────────────────────────────────────
insert into meta(key, value) values
  ('base_capital', '500000000'::jsonb),
  ('rules_version', '"15/7.5·음봉0.8·10/10/80·리셋60·신저가2차·레버1.3·무비용·0버퍼손절"'::jsonb),
  ('last_eod_at', 'null'::jsonb),
  ('last_preclose_at', 'null'::jsonb)
on conflict (key) do nothing;
