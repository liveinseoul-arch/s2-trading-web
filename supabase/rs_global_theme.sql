-- 한미일 통합 단일 호출 테마 분류 (한 주차당 1행).
-- Supabase SQL Editor 에서 1회 실행.

create table if not exists rs_global_theme_weekly (
  week_date date primary key,
  summary text,                       -- 통합 한줄평 (한미일 전반)
  categories jsonb not null,          -- [{big, small?, tickers: ["005930.KS", "AAPL", "7203.T", ...]}]
  model text,
  generated_at timestamptz not null default now()
);

alter table rs_global_theme_weekly enable row level security;

drop policy if exists rs_global_theme_weekly_read on rs_global_theme_weekly;
create policy rs_global_theme_weekly_read on rs_global_theme_weekly
  for select using (true);

create index if not exists rs_global_theme_weekly_week_idx
  on rs_global_theme_weekly (week_date desc);
