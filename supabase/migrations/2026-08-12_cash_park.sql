-- ★현금 파킹(S2_CASH_PARK) — daily_order_plan.order_type 에 'cash_park' 허용
--
-- [왜] S2 는 결정창 2,210일 중 1,749일(79.1%)을 전액 현금으로 논다(평균 유휴현금 96.2%).
--      그 현금을 KODEX 단기채권(153130)에 파킹하면 무차입 Calmar 가
--      0.6867 → 0.8899 로 오른다(ΔCalmar +0.2032 · 저점일 동일 · 부트스트랩 3/3 유의).
--      근거: quant_infra/2026-08/BOND_OVERLAY_2026-08-12.md
--
-- [무엇을 하나] 매일 "유휴현금 X원을 153130 에 파킹하라"는 목표 줄을 감시주문에 얹는다.
--      ★이 제약을 먼저 풀지 않으면 export_eod.py 적재가 CHECK 위반으로 통째로 실패한다.
--
-- [되돌리기] 아래 rollback 블록 참조.

alter table daily_order_plan
  drop constraint if exists daily_order_plan_order_type_check;

alter table daily_order_plan
  add constraint daily_order_plan_order_type_check
  check (order_type in ('buy_add','sell','stop','newlow_stop','cash_park'));

-- ── rollback (파킹을 끄고 되돌릴 때) ──────────────────────────────
-- ⚠️★먼저 run_eod.ps1 에서 $env:S2_CASH_PARK 줄을 지우고,
--    기존 cash_park 행을 정리한 뒤에 제약을 좁힌다. 순서를 바꾸면 실패한다.
--
-- delete from daily_order_plan where order_type = 'cash_park';
-- alter table daily_order_plan
--   drop constraint if exists daily_order_plan_order_type_check;
-- alter table daily_order_plan
--   add constraint daily_order_plan_order_type_check
--   check (order_type in ('buy_add','sell','stop','newlow_stop'));
