-- 풀 유니버스 RS 시계열 (한미일 시총 필터 통과한 모든 종목).
-- 종전 rs_top_weekly 는 RS96+ 만, rs_history_weekly 는 RS96+ 에 한 번이라도 든 종목만.
-- 본 테이블은 모든 universe 종목의 매주 RS 를 저장 (RS=10도 저장) → RS 조회 검색 기반.
-- Supabase SQL Editor 에서 1회 실행.

create table if not exists rs_universe_weekly (
  market text not null,                 -- 'KR' | 'US' | 'JP'
  ticker text not null,
  week_date date not null,
  name text,
  name_en text,
  rs smallint not null,                 -- 0~99
  comp_return double precision,
  close double precision,
  mktcap double precision,
  primary key (market, ticker, week_date)
);

create index if not exists rs_universe_weekly_ticker_idx
  on rs_universe_weekly (ticker);
create index if not exists rs_universe_weekly_name_idx
  on rs_universe_weekly (lower(name));
create index if not exists rs_universe_weekly_name_en_idx
  on rs_universe_weekly (lower(name_en));
create index if not exists rs_universe_weekly_week_market_idx
  on rs_universe_weekly (week_date desc, market);

alter table rs_universe_weekly enable row level security;

drop policy if exists rs_universe_weekly_read on rs_universe_weekly;
create policy rs_universe_weekly_read on rs_universe_weekly
  for select using (true);
