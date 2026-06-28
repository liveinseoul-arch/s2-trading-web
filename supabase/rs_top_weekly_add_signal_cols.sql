-- rs_top_weekly 에 보조 신호 컬럼 추가 (RS96+ 화면 표시용)
--   align_weeks : 주봉 loose 정배열(MA4>MA13>MA26>MA52) 연속 유지 주수 (트렌드 나이). 미정배열=0.
--   climax_warn : 클라이맥스/블로우오프 진입 주의 (52주 신고가+거래량급증+장대양봉 최근 3주내).
--
-- Supabase SQL Editor 에서 1회 실행. 이후 export_rs_weekly.py 가 매주 채움.
-- (export 는 컬럼 존재를 probe 하여, 이 ALTER 전이라도 적재가 깨지지 않고 컬럼만 생략함.)
alter table public.rs_top_weekly
  add column if not exists align_weeks smallint,
  add column if not exists climax_warn boolean;
