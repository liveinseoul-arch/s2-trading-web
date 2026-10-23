-- =====================================================================
-- ★★rs_universe_ticker_swap — ★`rs_universe_weekly` 를 ★종목 범위로 ★한 트랜잭션에 ★교체
--   CAND-2026-10-20-8  (★`CAND-2026-10-20-29` 스테이징 swap 의 ★종목 범위판)
--   보고   → quant_infra/2026-10/RS_SWAP_QUEUE_CLOSE_2026-10-23.md
--   모체   → supabase/migrations/2026-10-20_rs_weekly_swap.sql (★적용 완료)
-- =====================================================================
--
-- [★왜 모체 함수를 ★그대로 못 쓰나 — ★한 줄]
--   ★모체 `rs_weekly_swap(markets text[], universe_scope boolean, last_at text)` 는
--   ★`delete ... where market = any($1)` 이라 ★**시장 전체**를 교체한다.
--   ★`add_etfs.py` 가 필요한 범위는 ★**(시장, 종목) 1건**이다 — ★모체를 부르면
--   ★★**그 시장의 ★본표 전체가 ★ETF 48종목으로 ★교체돼 ★전멸한다.**
--   ⇒ ★함수를 ★하나 ★더 만든다. ★★**스테이징 표는 ★모체가 만든 것을 ★그대로 쓴다**
--     (★`rs_universe_weekly_staging` · ★이 파일은 ★표를 ★하나도 만들지 않는다).
--
-- [★무엇이 만들어지나 — ★함수 1개뿐]
--   ★① `rs_universe_ticker_swap(p_market text, p_tickers text[])`
--   ★② 표 ★0개 · 컬럼 ★0개 · 정책 ★0개 · 본표 ★무접촉.
--
-- [★왜 `meta` 를 ★안 건드리나 — ★모체와 ★다른 점]
--   ★모체는 ★주간 적재의 ★완료 신호(`last_rs_weekly_at`)를 ★같은 트랜잭션에 넣는다.
--   ★`add_etfs.py` 는 ★종전 경로에서 ★`meta` 를 ★한 번도 ★쓰지 않는다
--   (★`:369-372` 가 ★DELETE + POST ★둘뿐이다) ⇒ ★★**여기서도 ★안 쓴다.**
--   ★그래야 ★게이트 off 와 ★on 의 ★요청 열이 ★그 항목에서 ★어긋나지 않는다.
--
-- [★스테이징을 ★언제 비우나 — ★모체 규칙 승계]
--   ★★**적재 ★시작 때** ★그 (시장, 종목)분만 ★파이썬이 비운다.
--   ★★이 함수는 ★**비우지 않는다** — ★swap 이 성공했는데 ★정리에서 죽으면 ★다음 런이 혼란스럽다.
--   ⚠️★★**비우는 것이 ★선택이 아니라 ★필수다** — ★주간 swap 이 ★스테이징을 ★비우지 않고
--     ★끝나므로(모체 설계) ★`rs_universe_weekly_staging` 에는 ★그 시장의 ★export 행이
--     ★그대로 남아 있다. ★그 안에 ★같은 종목이 있으면 ★`insert ... select` 가 ★두 벌을 넣는다.
--     ★파이썬이 ★(시장, 종목) 범위를 ★먼저 지우면 ★그 잔해까지 ★함께 사라진다.
--
-- [⚠️★되돌리기]
--   ★`S2_ETF_SWAP=0`(★기본값) ★한 줄이면 ★파이썬이 ★종전 경로(종목별 DELETE + POST)를 탄다.
--   ★전부 지우려면:
--     drop function if exists public.rs_universe_ticker_swap(text, text[]);
--   ⚠️★스테이징 표는 ★모체 소유다 — ★이 파일을 되돌릴 때 ★**지우지 않는다.**
--
-- [⚠️★보안]
--   ★모체와 ★같다 — ★security definer + ★`search_path` 고정 + ★`service_role` 만 execute.
--
-- [⚠️★pg_safeupdate]
--   ★여기 DELETE 는 ★`where market = ... and ticker = any(...)` 이라
--   ★WHERE 없는 DELETE 거부에 ★안 걸린다.
-- =====================================================================

create or replace function public.rs_universe_ticker_swap(
  p_market  text,
  p_tickers text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tbl  text := 'rs_universe_weekly';
  v_stg  text := 'rs_universe_weekly_staging';
  v_cols text;
  v_del  bigint;
  v_ins  bigint;
  v_stgn bigint;
begin
  -- ★본문이 작아 ★이 줄이 ★실제로 유효하다(모체 주석 :102 와 같은 이유).
  set local statement_timeout = '300s';

  -- ── 범위 검사 — ★호출자가 ★명시한다(행에서 유도하지 않는다) ──────────
  if p_market is null or btrim(p_market) = '' then
    raise exception
      '[rs_universe_ticker_swap] p_market 이 비었다 — 교체 범위를 정할 수 없다';
  end if;
  if p_tickers is null or cardinality(p_tickers) = 0 then
    raise exception
      '[rs_universe_ticker_swap] p_tickers 가 비었다 — 교체 범위를 정할 수 없다';
  end if;

  -- ★쓰기가능 컬럼만 — ★identity·generated 제외(모체 주석 ⓐⓑ와 ★같은 이유).
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid     = ('public.' || quote_ident(v_tbl))::regclass
     and a.attnum       > 0
     and not a.attisdropped
     and a.attidentity  = ''
     and a.attgenerated = '';

  if v_cols is null then
    raise exception '[rs_universe_ticker_swap] %: 쓰기가능 컬럼이 0 이다', v_tbl;
  end if;

  -- ⚠️★본표에 컬럼이 추가되면 ★스테이징과 어긋난다 — ★그 자리에서 멈춘다.
  if exists (
      select 1
        from (select a.attname, a.atttypid
                from pg_attribute a
               where a.attrelid = ('public.' || quote_ident(v_tbl))::regclass
                 and a.attnum > 0 and not a.attisdropped
                 and a.attidentity = '' and a.attgenerated = '') t
   full join (select a.attname, a.atttypid
                from pg_attribute a
               where a.attrelid = ('public.' || quote_ident(v_stg))::regclass
                 and a.attnum > 0 and not a.attisdropped
                 and a.attidentity = '' and a.attgenerated = '') s
          on t.attname = s.attname and t.atttypid = s.atttypid
       where t.attname is null or s.attname is null
  ) then
    raise exception
      '[rs_universe_ticker_swap] 본표와 스테이징의 컬럼이 어긋난다 — 스테이징을 다시 만들 것 '
      '(drop table public.rs_universe_weekly_staging; 그리고 '
      '2026-10-20_rs_weekly_swap.sql 재실행)';
  end if;

  -- ★스테이징에 ★그 (시장, 종목) 행이 ★몇 건인가 — ★검산의 기준값
  execute format(
    'select count(*) from public.%I where market = $1 and ticker = any($2)', v_stg)
    into v_stgn using p_market, p_tickers;

  -- ⚠️★0 건이면 ★교체하지 않는다 — ★종전 경로가 ★`if not rows: return 0` 으로
  --   ★DELETE 조차 ★안 하는 것과 ★같은 동작이다(add_etfs.py:365-367).
  if v_stgn = 0 then
    raise exception
      '[rs_universe_ticker_swap] 스테이징 % / % 가 0건이다 — 빈 교체를 거부한다',
      p_market, array_to_string(p_tickers, ',');
  end if;

  execute format(
    'delete from public.%I where market = $1 and ticker = any($2)', v_tbl)
    using p_market, p_tickers;
  get diagnostics v_del = row_count;

  execute format(
    'insert into public.%I (%s) select %s from public.%I '
    'where market = $1 and ticker = any($2)',
    v_tbl, v_cols, v_cols, v_stg) using p_market, p_tickers;
  get diagnostics v_ins = row_count;

  -- ⚠️★조용한 부분 교체를 막는다 — ★스테이징 행수와 ★넣은 행수가 같아야 한다.
  if v_ins <> v_stgn then
    raise exception
      '[rs_universe_ticker_swap] 스테이징 %건 중 %건만 옮겨졌다', v_stgn, v_ins;
  end if;

  return jsonb_build_object(
    'market',   p_market,
    'tickers',  to_jsonb(p_tickers),
    'staging',  v_stgn,
    'deleted',  jsonb_build_object(v_tbl, v_del),
    'inserted', jsonb_build_object(v_tbl, v_ins));
end;
$fn$;

revoke all on function public.rs_universe_ticker_swap(text, text[]) from public;
revoke all on function public.rs_universe_ticker_swap(text, text[]) from anon;
revoke all on function public.rs_universe_ticker_swap(text, text[]) from authenticated;
grant execute on function public.rs_universe_ticker_swap(text, text[]) to service_role;

comment on function public.rs_universe_ticker_swap(text, text[]) is
  'rs_universe_weekly 를 (시장, 종목) 범위로 스테이징에서 한 트랜잭션에 교체 (CAND-2026-10-20-8). add_etfs.py 의 종목별 DELETE+POST 를 대체한다. 실패 시 ROLLBACK 이라 본표 종전 데이터가 남는다. 스테이징 표는 2026-10-20_rs_weekly_swap.sql 소유. 되돌리기 = S2_ETF_SWAP=0.';
