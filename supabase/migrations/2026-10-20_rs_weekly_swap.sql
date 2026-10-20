-- =====================================================================
-- ★★rs_weekly_swap — ★RS 주간 3표를 ★스테이징에서 ★한 트랜잭션에 ★교체
--   CAND-2026-10-20-29  (★`CAND-2026-10-19-45` 의 ★대체 설계)
--   사양서 → quant_infra/2026-10/SPEC_RS_STAGING_SWAP_2026-10-20.md
--   측정   → quant_infra/2026-10/RS_RPC_BODYLIMIT_2026-10-20.md
-- =====================================================================
--
-- [★왜 모체를 대체하나]
--   ★`rs_weekly_replace(payload jsonb)`(2026-10-20 적용 완료)는 ★3표를 ★요청 ★1회에 담는데
--   ★그 본문이 ★17.9 – 28.7 MB 다. ★실측(쓰기 0 프로브 4점):
--       1.02 MB →  2.6초 ★통과      10.24 MB →  8.4초 ★통과
--      20.51 MB → 26.0초 ★**500 `canceling statement due to statement timeout`**
--      30.81 MB → 69.2초 ★**520**
--   ★★비용이 ★초선형이다(크기 2배 → 시간 3배). ★표적 KR 17.87 · JP 21.31 · US 28.73 MB 가
--   ★**전부 실패 구간이거나 그 경계**다.
--   ⚠️★★그리고 ★모체 `:100` 의 `set local statement_timeout='300s'` 는 ★**무력하다** —
--     ★타임아웃이 ★함수에 ★들어가기 ★전(PostgREST 가 본문을 jsonb 로 파싱하는 단계)에 난다.
--
-- [★★착상 — 한 줄]
--   ★★**원자성은 ★「한 요청」이 아니라 ★「한 트랜잭션」에서 나온다.**
--   ★데이터는 ★작은 청크로 ★스테이징 표에 ★미리 올리고(종전과 ★같은 요청 모양),
--   ★본표 교체만 ★이 함수 ★1회로 ★원자적으로 한다. ★이 함수의 ★본문은 ★1 KB 미만이다.
--
-- [★무엇이 만들어지나]
--   ★① 스테이징 표 3개  — `create table … (like 본표 including all)`
--      ★★**본표를 ★한 줄도 안 건드린다.** ★컬럼·타입·제약·인덱스·기본값을 ★복제하므로
--      ★★**두 본표의 DDL 을 ★몰라도 된다**(`CAND-2026-10-20-9` 우회).
--   ★② `rs_weekly_swap(markets, universe_scope, last_at)` 함수
--
-- [⚠️★★`insert … select *` 를 ★쓰지 않는 이유 — ★설계서 v2 의 ★정정]
--   ★사양서 §9 #8 은 ★「`select *` 이라 ★동적 컬럼이 ★불필요하다」고 적었는데 ★**틀렸다.**
--   ★`like … including all` 은 ★`identity`·`generated` 컬럼도 ★복제한다. ★그러면
--     ★ⓐ `GENERATED ALWAYS` 면 ★`insert … select *` 가 ★**에러**로 죽고,
--     ★ⓑ `BY DEFAULT` 면 ★**스테이징 시퀀스 값**이 ★본표로 넘어가 ★본표 시퀀스와 ★어긋난다.
--   ★★그래서 ★여기서도 ★**쓰기가능 컬럼만** 골라 ★`insert into t (cols) select cols from s` 한다.
--   ⚠️★**다만 ★모체와 ★이유가 다르다** — 모체는 ★「페이로드 키와 맞추려고」 동적이었고
--     ★여기는 ★「identity·generated 회피」다. ★★그리고 ★**비용이 0 이다** —
--     ★컬럼 목록을 ★서버가 만들어서 ★요청 본문에 ★안 실린다.
--
-- [★스테이징을 ★언제 비우나]
--   ★★**적재 ★시작 때** ★그 시장분만 비운다(파이썬 쪽 · 사양서 §7 규칙 1).
--   ★★이 함수는 ★**비우지 않는다** — ★swap 이 성공했는데 ★정리에서 죽으면 ★다음 런이 혼란스럽다.
--   ★시작 때 비우면 ★이전 실패 잔해가 ★자동으로 사라진다(멱등).
--
-- [⚠️★되돌리기]
--   ★`S2_RS_SWAP=0`(★기본값) ★한 줄이면 ★파이썬이 ★종전 경로를 탄다.
--   ★전부 지우려면:
--     drop function if exists public.rs_weekly_swap(text[], boolean, text);
--     drop table if exists public.rs_top_weekly_staging;
--     drop table if exists public.rs_history_weekly_staging;
--     drop table if exists public.rs_universe_weekly_staging;
--   ⚠️★본표·본표 컬럼·제약·정책은 ★하나도 건드리지 않는다.
--
-- [⚠️★보안]
--   ★스테이징 표에 ★RLS 를 켜고 ★정책을 ★두지 않는다 = ★anon·authenticated 는 ★한 행도 못 본다.
--   ★`service_role` 은 ★RLS 를 우회하므로 ★적재가 된다(종전 키와 ★같은 권한).
--   ★함수는 ★security definer + ★`search_path` 고정.
--
-- [⚠️★pg_safeupdate]
--   ★여기 DELETE 는 ★전부 `where market = any(...)` 이라 ★WHERE 없는 DELETE 거부에 ★안 걸린다.
-- =====================================================================

-- ── ① 스테이징 표 3개 ────────────────────────────────────────────────
create table if not exists public.rs_top_weekly_staging
  (like public.rs_top_weekly including all);
create table if not exists public.rs_history_weekly_staging
  (like public.rs_history_weekly including all);
create table if not exists public.rs_universe_weekly_staging
  (like public.rs_universe_weekly including all);

alter table public.rs_top_weekly_staging      enable row level security;
alter table public.rs_history_weekly_staging  enable row level security;
alter table public.rs_universe_weekly_staging enable row level security;

comment on table public.rs_top_weekly_staging is
  'rs_top_weekly 적재 스테이징 (CAND-2026-10-20-29). 적재 시작 때 그 시장분을 비우고 청크 POST → rs_weekly_swap() 가 한 트랜잭션에 본표로 옮긴다.';
comment on table public.rs_history_weekly_staging is
  'rs_history_weekly 적재 스테이징 (CAND-2026-10-20-29).';
comment on table public.rs_universe_weekly_staging is
  'rs_universe_weekly 적재 스테이징 (CAND-2026-10-20-29).';

-- ── ② swap 함수 ──────────────────────────────────────────────────────
create or replace function public.rs_weekly_swap(
  markets        text[],
  universe_scope boolean default false,
  last_at        text    default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tbl   text;
  v_stg   text;
  v_cols  text;
  v_del   bigint;
  v_ins   bigint;
  v_stgn  bigint;
  v_d     jsonb := '{}'::jsonb;
  v_i     jsonb := '{}'::jsonb;
begin
  -- ★본문이 작아 ★이제는 ★이 줄이 ★실제로 유효하다(모체에서는 무력했다).
  set local statement_timeout = '300s';

  -- ── 범위 검사 — ★호출자가 ★명시한다(행에서 유도하지 않는다) ──────────
  if markets is null or cardinality(markets) = 0 then
    raise exception
      '[rs_weekly_swap] markets 가 비었다 — 교체 범위를 정할 수 없다';
  end if;

  foreach v_tbl in array array['rs_top_weekly',
                               'rs_history_weekly',
                               'rs_universe_weekly']
  loop
    if v_tbl = 'rs_universe_weekly' and not universe_scope then
      continue;
    end if;
    v_stg := v_tbl || '_staging';

    -- ★쓰기가능 컬럼만 — ★identity·generated 제외(위 주석 ⓐⓑ).
    --   ★순서는 ★표 컬럼 순(attnum)이라 ★양쪽이 같다.
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid     = ('public.' || quote_ident(v_tbl))::regclass
       and a.attnum       > 0
       and not a.attisdropped
       and a.attidentity  = ''
       and a.attgenerated = '';

    if v_cols is null then
      raise exception '[rs_weekly_swap] %: 쓰기가능 컬럼이 0 이다', v_tbl;
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
        '[rs_weekly_swap] %: 본표와 스테이징의 컬럼이 어긋난다 — 스테이징을 다시 만들 것 '
        '(drop table public.%I; 그리고 이 마이그레이션 재실행)', v_tbl, v_stg;
    end if;

    -- ★스테이징에 ★그 시장 행이 ★몇 건인가 — ★검산의 기준값
    execute format('select count(*) from public.%I where market = any($1)', v_stg)
      into v_stgn using markets;

    execute format('delete from public.%I where market = any($1)', v_tbl)
      using markets;
    get diagnostics v_del = row_count;

    execute format(
      'insert into public.%I (%s) select %s from public.%I where market = any($1)',
      v_tbl, v_cols, v_cols, v_stg) using markets;
    get diagnostics v_ins = row_count;

    -- ⚠️★조용한 부분 교체를 막는다 — ★스테이징 행수와 ★넣은 행수가 같아야 한다.
    if v_ins <> v_stgn then
      raise exception
        '[rs_weekly_swap] %: 스테이징 %건 중 %건만 옮겨졌다', v_tbl, v_stgn, v_ins;
    end if;

    v_d := v_d || jsonb_build_object(v_tbl, v_del);
    v_i := v_i || jsonb_build_object(v_tbl, v_ins);
  end loop;

  -- ── 완료 신호도 ★같은 트랜잭션 안이다 ────────────────────────────────
  --   ★값은 ★호출자가 만든 시각 문자열(종전 PATCH 와 같은 값) · ★`updated_at` 은 now().
  if last_at is not null then
    insert into public.meta (key, value, updated_at)
    values ('last_rs_weekly_at', to_jsonb(last_at), now())
    on conflict (key) do update
      set value = excluded.value, updated_at = now();
  end if;

  return jsonb_build_object(
    'markets',           to_jsonb(markets),
    'universe_scope',    universe_scope,
    'deleted',           v_d,
    'inserted',          v_i,
    'last_rs_weekly_at', last_at);
end;
$fn$;

revoke all on function public.rs_weekly_swap(text[], boolean, text) from public;
revoke all on function public.rs_weekly_swap(text[], boolean, text) from anon;
revoke all on function public.rs_weekly_swap(text[], boolean, text) from authenticated;
grant execute on function public.rs_weekly_swap(text[], boolean, text) to service_role;

comment on function public.rs_weekly_swap(text[], boolean, text) is
  'RS 주간 3표를 스테이징에서 시장별로 한 트랜잭션에 교체 (CAND-2026-10-20-29). 요청 본문이 1KB 미만이라 rs_weekly_replace 의 statement_timeout 벽을 피한다. 실패 시 ROLLBACK 이라 본표 종전 데이터가 남는다. 되돌리기 = S2_RS_SWAP=0.';
