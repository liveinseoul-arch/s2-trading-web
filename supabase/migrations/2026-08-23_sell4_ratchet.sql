-- ★★스톱 래칫 4단계 매도 — executions.action 에 'sell_4' 허용 (+ 5–9 선개방)
--
-- [왜] 2026-08-21 스톱 래칫을 채택해 매도가 3단계 → ★4단계가 됐다
--      (S2_SELL_STAGE_PCTS=0.01,0.01,0.005 → 1·2·3차 소량 + 4차 잔량 97.5%).
--      export_eod.py:260 `N_STAGES = len(SELL_STAGE_PCTS) + 1` = 4 이고
--      :799 가 `f"sell_{stg}"` 를 내므로 ★'sell_4' 가 적재된다.
--      근거: quant_infra/2026-08/S2_STOP_RATCHET_2026-08-21.md · CLAUDE.md §8-3
--
-- [무엇이 났나 — ★이미 사고가 났다]
--      ★2026-08-21 15:45 S2_eod 가 rc=1 로 죽었다.
--      export_eod.py 는 9개 테이블을 ★전삭제 후 재적재하는데,
--      삭제는 되고 ★첫 sell_4 행에서 CHECK 위반으로 멈췄다 →★테이블이 비었다.
--      실측(2026-08-23) — daily_candidates 0 · position_snapshots 0 ·
--        nav_daily 0 · daily_counts 0 · executions 0 (trades 만 544 잔존).
--      오류: code 23514 "violates check constraint executions_action_check"
--        Failing row: (..., 047770 코데즈컴바인, KQ, ★sell_4, 4, ...)
--
-- [파급] ⚠️웹앱이 「데이터가 아직 없습니다」로 빈다.
--      ⚠️★nav_daily 가 0 이면 S2_nav_calendar 가 autotrade\nav_daily.csv 를 못 갱신하고
--        kw_watchloop.py --run 이 ★거래일 캘린더 신선도 게이트에 걸려 rc=4 로 거부된다(§7-4).
--
-- [★왜 열거가 아니라 정규식인가 — 해달별님 결정 2026-08-23]
--      ★2026-08-12 cash_park 마이그레이션이 ★같은 사고를 이미 겪었고,
--      그 파일이 스스로 이렇게 적어 두었다:
--        「★이 제약을 먼저 풀지 않으면 export_eod.py 적재가 CHECK 위반으로 통째로 실패한다」
--      ★그런데 08-21 래칫 채택 때는 ★마이그레이션을 안 썼고 ★같은 사고가 재발했다.
--      ★★그래서 sell_1..sell_9 를 ★미리 열어 ★이 사고 계열을 닫는다.
--      ★단계 수가 또 바뀌어도(5단계·6단계) ★스키마가 안 깨진다.
--      ⚠️sell_0 은 막는다 — 단계는 1부터다. 두 자리(sell_10)도 막는다(그때는 다시 논의).
--
-- [되돌리기] 아래 rollback 블록 참조.

alter table executions
  drop constraint if exists executions_action_check;

alter table executions
  add constraint executions_action_check
  check (action ~ '^(buy_new|buy_add|sell_[1-9]|stop|newlow_stop)$');

-- ── 확인 (실행 후 붙여넣어 본다) ──────────────────────────────────
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint where conrelid = 'executions'::regclass and contype = 'c';
-- → check ((action ~ '^(buy_new|buy_add|sell_[1-9]|stop|newlow_stop)$'::text))

-- ── rollback (4단계를 되돌릴 때) ──────────────────────────────────
-- ⚠️★순서가 있다 — 먼저 run_eod.ps1 에서 $env:S2_SELL_STAGE_PCTS 줄을 지워
--    매도를 3단계로 되돌리고, 기존 sell_4 행을 정리한 뒤에 제약을 좁힌다.
--    ★순서를 바꾸면 실패한다(2026-08-12 파일과 같은 이유).
--
-- delete from executions where action in ('sell_4','sell_5','sell_6','sell_7','sell_8','sell_9');
-- alter table executions
--   drop constraint if exists executions_action_check;
-- alter table executions
--   add constraint executions_action_check
--   check (action in ('buy_new','buy_add','sell_1','sell_2','sell_3','stop','newlow_stop'));
