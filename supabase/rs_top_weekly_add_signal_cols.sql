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

-- 일봉 21/50 EMA (미너비니 트레일링 손절선) 스냅샷 — 최근 금요일 as-of.
--   엔진(17_90)과 동일식 ewm(span, adjust=False). RS86+ FTD 일봉캐시 보유 종목만 값 존재.
--   주봉 이평(price_ma_*)과 달리 *일봉* 기준 — 보유 종목의 트레일링 손절 참고선.
alter table public.rs_top_weekly
  add column if not exists ema_21  real,
  add column if not exists ema_50  real;
alter table public.rs_universe_weekly
  add column if not exists ema_21  real,
  add column if not exists ema_50  real;

-- 클라이맥스(⚡) 진단 — climax_warn 일 때 '가장 최근 클라이맥스 주'의 3조건 실제 수치.
--   climax_week     : 그 클라이맥스가 발생한 주차(금요일, ISO date text)
--   climax_vol_mult : 그 주 거래량 / 13주평균 (≥2.0 이면 ② 거래량 충족)
--   climax_ret      : 그 주 주간 수익률(%) (≥5 이면 ③ 장대양봉 충족)
--   ① 신고가는 클라이맥스 정의상 항상 충족 → 별도 컬럼 없이 ✓ 표시.
alter table public.rs_top_weekly
  add column if not exists climax_week      text,
  add column if not exists climax_vol_mult  real,
  add column if not exists climax_ret       real;
alter table public.rs_universe_weekly
  add column if not exists climax_week      text,
  add column if not exists climax_vol_mult  real,
  add column if not exists climax_ret       real;
