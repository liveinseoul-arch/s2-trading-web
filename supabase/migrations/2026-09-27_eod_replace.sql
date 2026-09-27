-- =====================================================================
-- ★★eod_replace(payload jsonb) — ★EOD 9표 적재를 ★단일 트랜잭션으로
--   CAND-2026-09-08-4 ★2단계 C (해달별님 착수 결정 2026-09-27)
--   설계 원문 → quant_infra/2026-09/AUTOTRADE_EOD_ATOMIC_DESIGN_2026-09-11.md §2-2 C
-- =====================================================================
--
-- [★왜 필요한가 — ★사고가 ★3번 났다]
--   ★export_eod.py 는 9표를 ★전삭제한 뒤 ★청크로 재적재한다. ★그 사이에 죽으면
--   ★표가 ★「낡은」이 아니라 ★「빈」 상태로 남고, ★웹앱·데몬·캘린더가 ★그것을 읽는다.
--
--     2026-08-21  ★CHECK 위반(23514 · 'sell_4')     → daily_candidates 0 · nav_daily 0
--                 ⚠️★★4xx 다 — ★재시도 래퍼가 ★원리적으로 못 막는다
--     2026-09-02  ★SystemExit(supabase 실패)         → run_eod.ps1:35 주석
--     2026-09-25  ★네트워크 단절(35초 초과)           → nav_daily ★500행(1청크)만
--
--   ★★즉 ★원인이 ★두 부류(4xx · 네트워크)인데 ★기존 처치는 ★각각 하나씩만 덮었다:
--     ★재시도 래퍼(CAND-2026-09-02-15) = 네트워크만 · ★그나마 ★예산 35초로 ★부족했다
--     ★마커 프로토콜 D(1단계)          = ★가시화일 뿐 ★공백 자체는 남는다
--   ★★트랜잭션은 ★둘 다 덮는다 — ★실패하면 ★ROLLBACK 이라 ★종전 데이터가 ★그대로 남는다.
--
-- [★무엇이 달라지나]
--   종전: DELETE x9  +  POST x수십(청크 500)  +  PATCH meta      = ★요청 수십 · 공백 창 5.5 – 20분
--   현행: POST /rpc/eod_replace x1                               = ★요청 1 · ★공백 창 ★0
--
-- [⚠️★되돌리기]
--   ★`S2_EOD_RPC=0` ★한 줄이면 ★파이썬이 ★종전 경로를 탄다(이 함수를 ★안 부른다).
--   ★함수를 지우려면: drop function if exists public.eod_replace(jsonb);
--   ⚠️★이 마이그레이션은 ★함수만 만든다 — ★표·컬럼·제약을 ★하나도 건드리지 않는다.
--
-- [⚠️★보안]
--   ★security definer 다 — ★RLS 를 우회해 쓰기 위해서다(종전 service_role 키와 ★같은 권한).
--   ★그래서 ★anon·authenticated 에게 ★EXECUTE 를 ★주지 않는다(아래 REVOKE).
--   ★search_path 를 ★고정해 ★search_path 주입을 막는다.
--
-- [⚠️★statement_timeout]
--   ★service_role 의 기본값을 ★확인하지 못했다(PostgREST 로는 SHOW 를 못 부른다).
--   ★그래서 ★역할 기본값에 ★의존하지 않고 ★함수 안에서 ★SET LOCAL 로 올린다.
--   ★SET LOCAL 이라 ★이 트랜잭션에만 적용되고 ★끝나면 되돌아간다.
--
-- [★페이로드 크기 — ★실측 2026-09-27]
--   ★19,124행 · ★JSON ★3.91 MB(비압축) · ★gzip 어림 0.33 – 0.49 MB.
--   ★하루 약 +9행이라 ★연 증가는 ★수십 KB 수준이다.
--   ⚠️★파이썬이 ★gzip 으로 보낸다(Content-Encoding: gzip) — ★프록시 본문 상한을 피한다.
-- =====================================================================

create or replace function public.eod_replace(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_last  text := payload->>'last_date';
  v_out   jsonb;
begin
  -- ★역할 기본값에 의존하지 않는다(위 주석). ★SET LOCAL = 이 트랜잭션 한정.
  set local statement_timeout = '180s';

  -- ── ① 전삭제 — FK 안전 순서 ────────────────────────────────────────
  --   ⚠️★이 DELETE 들은 ★같은 트랜잭션 안이다. ★독자는 ★중간 상태를 ★볼 수 없다.
  --   ★TRUNCATE 가 아니라 DELETE 인 이유 — TRUNCATE 는 ★ACCESS EXCLUSIVE 락이라
  --   ★읽기까지 막는다. ★DELETE 는 ★읽기를 막지 않고 ★MVCC 로 종전 스냅샷을 보여준다.
  --   ⚠️★★[2026-09-27 실패 뒤 수정] ★`where true` 가 ★필수다 — ★장식이 아니다.
  --   ★Supabase 는 ★`pg_safeupdate` 가 켜져 있어 ★**WHERE 없는 DELETE 를 거부**한다:
  --     `{"code":"21000","message":"DELETE requires a WHERE clause"}`
  --   ★맨 `delete from t;` 9줄이 ★전부 여기 걸렸다(★첫 실적재 시도 2026-09-27 21:30).
  --   ⚠️★★**지우지 말 것** — ★지우면 ★같은 400 이 ★그대로 재발한다.
  --   ★`where true` 는 ★행을 ★하나도 안 거른다 — ★의미는 맨 DELETE 와 ★동일하다.
  delete from trade_legs where true;
  delete from trades where true;
  delete from executions where true;
  delete from daily_order_plan where true;
  delete from daily_candidates where true;
  delete from position_snapshots where true;
  delete from nav_daily where true;
  delete from monthly_stats where true;
  delete from daily_counts where true;

  -- ── ② trades + trade_legs — ★_tid 매핑을 ★SQL 안에서 한다 ──────────
  --   ★종전에는 파이썬이 `return=representation` 으로 id 를 회수해 매핑했다.
  --   ★단일 요청이 되면 ★그 왕복이 없으므로 ★여기서 id 를 ★미리 뽑는다.
  -- ⚠️★★임시표로 ★3문장으로 나눈다 — ★CTE 한 문장보다 ★명백히 옳다.
  --   ★종전 초안은 `with src as materialized (...), ins_trades as (...) insert into trade_legs ...`
  --   였는데, ★그러면 ★`trade_legs` 의 FK 검사가 ★같은 문장 안의 ★다른 CTE(`ins_trades`) 완료에
  --   ★의존한다. ★PostgreSQL 규약상 성립하지만(데이터 변경 CTE 는 항상 완료까지 실행되고
  --   ★FK 는 문장 끝 AFTER 트리거다) ★★읽는 사람이 ★그 규약을 ★알아야만 안전을 확인할 수 있다.
  --   ★★여기서는 ★순서가 ★눈에 보이는 편이 낫다 — ★이 함수는 ★사고 뒤에 ★급히 읽힐 코드다.
  --   ⚠️★`nextval` 은 ★임시표를 ★만들 때 ★한 번만 평가된다 — ★`as materialized` 논점이 ★사라진다.
  create temp table _eod_tmap on commit drop as
  select
    nextval(pg_get_serial_sequence('trades', 'id')) as new_id,
    x.*
  from jsonb_to_recordset(coalesce(payload->'trades', '[]'::jsonb)) as x(
    _tid         text,
    ticker       text,
    name         text,
    market       text,
    entry_date   date,
    exit_date    date,
    buy_count    smallint,
    max_invested bigint,
    proceeds     bigint,
    pnl          bigint,
    ret_pct      numeric,
    holding_days integer,
    exit_reason  text,
    status       text
  );

  insert into trades (
    id, ticker, name, market, entry_date, exit_date, buy_count,
    max_invested, proceeds, pnl, ret_pct, holding_days, exit_reason, status
  )
  overriding system value
  select
    new_id, ticker, name, market, entry_date, exit_date, buy_count,
    max_invested, proceeds, pnl, ret_pct, holding_days, exit_reason,
    coalesce(status, 'open')
  from _eod_tmap;

  insert into trade_legs (trade_id, d, leg_type, stage, price, qty, amount, port_pct, hhmm)
  select m.new_id, l.d, l.leg_type, l.stage, l.price, l.qty, l.amount, l.port_pct, l.hhmm
  from jsonb_to_recordset(coalesce(payload->'legs', '[]'::jsonb)) as l(
    _tid     text,
    d        date,
    leg_type text,
    stage    smallint,
    price    bigint,
    qty      integer,
    amount   bigint,
    port_pct numeric,
    hhmm     text
  )
  join _eod_tmap m on m._tid = l._tid;

  -- ⚠️★★고아 leg 을 ★조용히 버리지 않는다 — ★join 이 ★안 맞으면 ★행이 ★사라질 뿐 ★에러가 안 난다.
  --   ★그것이 ★바로 ★이 프로젝트가 ★세 번 당한 ★「조용한 부분 적재」의 ★얼굴이다.
  if (select count(*) from jsonb_array_elements(coalesce(payload->'legs', '[]'::jsonb)))
     <> (select count(*) from trade_legs) then
    raise exception
      '[eod_replace] trade_legs 매핑 손실 — 보낸 %, 적재 %. _tid 가 trades 에 없다',
      (select count(*) from jsonb_array_elements(coalesce(payload->'legs', '[]'::jsonb))),
      (select count(*) from trade_legs);
  end if;

  -- ── ③ 나머지 7표 ───────────────────────────────────────────────────
  --   ★`jsonb_populate_recordset(null::<표>, …)` 로 ★컬럼 타입을 ★표에서 가져온다
  --   (★타입을 손으로 적지 않는다 = ★스키마가 바뀌어도 ★덜 깨진다).
  --   ⚠️★identity 컬럼(id)·default 컬럼(created_at)은 ★명시 목록에서 ★뺀다.

  insert into executions (
    d, ticker, name, market, action, stage, fill_price, qty, amount,
    port_pct, ma120_above, prev_spike_bull, blocked_by_leverage
  )
  select
    d, ticker, name, market, action, stage, fill_price, qty, amount,
    port_pct, ma120_above, prev_spike_bull, coalesce(blocked_by_leverage, false)
  from jsonb_populate_recordset(null::executions,
                                coalesce(payload->'executions', '[]'::jsonb));

  insert into daily_order_plan (
    d, ticker, name, market, order_type, stage, trigger_price, qty, port_pct, diff, note
  )
  select
    d, ticker, name, market, order_type, stage, trigger_price, qty, port_pct,
    coalesce(diff, 'keep'), note
  from jsonb_populate_recordset(null::daily_order_plan,
                                coalesce(payload->'daily_order_plan', '[]'::jsonb));

  insert into daily_candidates (
    d, ticker, kind, name, market, current_price, order_price, port_pct,
    ma120_above, prev_spike_bull, stage, reached, drop_to_pct, snapshot_at
  )
  select
    d, ticker, kind, name, market, current_price, order_price, port_pct,
    ma120_above, prev_spike_bull, coalesce(stage, 1), reached, drop_to_pct, snapshot_at
  from jsonb_populate_recordset(null::daily_candidates,
                                coalesce(payload->'daily_candidates', '[]'::jsonb));

  insert into position_snapshots (
    d, ticker, name, market, entry_date, buy_count, sell_count, qty,
    avg_buy, last_close, eval_amount, eval_pnl, ret_pct, port_pct
  )
  select
    d, ticker, name, market, entry_date, buy_count, sell_count, qty,
    avg_buy, last_close, eval_amount, eval_pnl, ret_pct, port_pct
  from jsonb_populate_recordset(null::position_snapshots,
                                coalesce(payload->'position_snapshots', '[]'::jsonb));

  insert into nav_daily (d, nav, cash, stock_value, leverage, dd_pct, n_positions)
  select d, nav, cash, stock_value, leverage, dd_pct, n_positions
  from jsonb_populate_recordset(null::nav_daily,
                                coalesce(payload->'nav_daily', '[]'::jsonb));

  insert into monthly_stats (
    month, num_trades, win_rate, avg_ret, realized_pnl,
    nav_start, nav_end, return_pct, mdd_pct
  )
  select
    month, num_trades, win_rate, avg_ret, realized_pnl,
    nav_start, nav_end, return_pct, mdd_pct
  from jsonb_populate_recordset(null::monthly_stats,
                                coalesce(payload->'monthly_stats', '[]'::jsonb));

  insert into daily_counts (d, n_candidates, n_reached, n_bought, n_blocked)
  select d, n_candidates, n_reached, n_bought, n_blocked
  from jsonb_populate_recordset(null::daily_counts,
                                coalesce(payload->'daily_counts', '[]'::jsonb));

  -- ── ④ meta — ★완료 신호도 ★같은 트랜잭션 안이다 ────────────────────
  --   ★종전에는 ⑥번째 PATCH 라 ★그 앞에서 죽으면 ★「빈 표 + 낡은 meta」였다.
  if v_last is not null then
    insert into meta (key, value, updated_at)
    values ('last_eod_at', to_jsonb(v_last), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  -- ★D안 마커와 공존한다 — ★RPC 경로에서는 ★loading 상태가 ★원리적으로 관측 불가라
  --   ★항상 ready 로 끝난다(★독자 쪽 조건문을 ★고치지 않아도 된다).
  insert into meta (key, value, updated_at)
  values ('eod_state', to_jsonb('ready'::text), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  -- ── ⑤ 적재 결과를 ★행수로 돌려준다 ─────────────────────────────────
  --   ⚠️★호출자는 ★rc 가 아니라 ★이 숫자로 검산한다
  --     (★2026-09-25 의 교훈 — `rc` 가 ★내용을 보증하지 않는다).
  select jsonb_build_object(
    'trades',             (select count(*) from trades),
    'trade_legs',         (select count(*) from trade_legs),
    'executions',         (select count(*) from executions),
    'daily_order_plan',   (select count(*) from daily_order_plan),
    'daily_candidates',   (select count(*) from daily_candidates),
    'position_snapshots', (select count(*) from position_snapshots),
    'nav_daily',          (select count(*) from nav_daily),
    'monthly_stats',      (select count(*) from monthly_stats),
    'daily_counts',       (select count(*) from daily_counts),
    'last_date',          v_last
  ) into v_out;

  return v_out;
end;
$fn$;

-- ★공개 역할에서 실행 권한을 뺀다 — ★service_role 만 부른다.
revoke all on function public.eod_replace(jsonb) from public;
revoke all on function public.eod_replace(jsonb) from anon;
revoke all on function public.eod_replace(jsonb) from authenticated;
grant execute on function public.eod_replace(jsonb) to service_role;

comment on function public.eod_replace(jsonb) is
  'EOD 9표 단일 트랜잭션 적재 (CAND-2026-09-08-4 2단계 C). 실패 시 ROLLBACK 이라 종전 데이터가 남는다. 되돌리기 = S2_EOD_RPC=0.';
