-- rs_top_weekly 에 보조 신호 컬럼 추가 (RS96+ 화면 표시용)
--   align_weeks : 주봉 loose 정배열(MA4>MA13>MA26>MA52) 연속 유지 주수 (트렌드 나이). 미정배열=0.
--   climax_warn : 클라이맥스/블로우오프 진입 주의 (52주 신고가+거래량급증+장대양봉 최근 3주내).
--
-- Supabase SQL Editor 에서 1회 실행. 이후 export_rs_weekly.py 가 매주 채움.
-- (export 는 컬럼 존재를 probe 하여, 이 ALTER 전이라도 적재가 깨지지 않고 컬럼만 생략함.)
alter table public.rs_top_weekly
  add column if not exists align_weeks smallint,
  add column if not exists climax_warn boolean;

-- 상세페이지 '이동평균(최신주)' 패널용 — 주가 4/13/26/52주, 거래량 4/13/26주 MA (스냅샷).
alter table public.rs_top_weekly
  add column if not exists price_ma_4   real,
  add column if not exists price_ma_13  real,
  add column if not exists price_ma_26  real,
  add column if not exists price_ma_52  real,
  add column if not exists vol_ma_4   double precision,
  add column if not exists vol_ma_13  double precision,
  add column if not exists vol_ma_26  double precision;

-- rs_history_weekly (기업 상세 페이지의 56주 시계열 표) 에도 추가:
--   align_weeks  : 그 주차의 정배열 연속주수 (정배열 여부 = align_weeks>0)
--   vol_gap_4_26 : 거래량 4주MA/26주MA-1 (%). 음수=4w<26w 역배열(거래량 데드크로스). 표시용(매도 알파 없음).
alter table public.rs_history_weekly
  add column if not exists align_weeks smallint,
  add column if not exists vol_gap_4_26 real;

-- rs_universe_weekly (RS() 가 쓰는 넓은 유니버스) 에도 — 구글시트 Apps Script 등에서
-- AAPL 같은 비RS96+ 종목도 정배열·거래량 신호를 조회할 수 있게.
alter table public.rs_universe_weekly
  add column if not exists align_weeks smallint,
  add column if not exists climax_warn boolean,
  add column if not exists vol_ma_4   double precision,
  add column if not exists vol_ma_13  double precision,
  add column if not exists vol_ma_26  double precision;

-- 이평값 패널을 전 종목(비RS96+ 포함)으로 확장 — 주가 이평 4컬럼.
alter table public.rs_universe_weekly
  add column if not exists price_ma_4   real,
  add column if not exists price_ma_13  real,
  add column if not exists price_ma_26  real,
  add column if not exists price_ma_52  real;
