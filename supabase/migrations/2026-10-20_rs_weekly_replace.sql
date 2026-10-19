-- =====================================================================
-- ★★rs_weekly_replace(payload jsonb) — ★RS 주간 3표 적재를 ★단일 트랜잭션으로
--   CAND-2026-10-19-45 (★`CAND-2026-09-08-4` 의 ★RS 판)
--   선례 → migrations/2026-09-27_eod_replace.sql (★EOD 9표 · `S2_EOD_RPC=1`)
--   설계 원문 → quant_infra/2026-10/RS_WEEKLY_ATOMIC_LOAD_2026-10-20.md
-- =====================================================================
--
-- [★왜 필요한가]
--   ★`export_rs_weekly.py:1037-1042` 가 ★3표를 ★시장별로 DELETE 한 뒤
--   ★청크로 재적재한다. ★그 사이에 죽으면 ★그 시장의 행이 ★「낡은」이 아니라
--   ★「빈」 상태로 남고 ★RS96 웹앱(`/rs96`·`/performance`)과 ★`add_etfs.py`·
--   ★`classify_rs96_gemini.py` 가 ★그 공백을 읽는다.
--
--   ★★EOD 쪽은 ★같은 결함으로 ★사고가 ★3번 났다(2026-08-21 4xx · 09-02 SystemExit ·
--   ★09-25 네트워크 단절). ★그 셋 중 ★재시도 래퍼가 막을 수 있는 것은 ★하나뿐이었다.
--   ★RS 쪽에는 ★`req` 단위 재시도(`S2_SUPABASE_RETRY`)가 ★있으나
--   ★★그것은 ★네트워크 부류만 덮고 ★4xx 는 ★원리적으로 못 덮는다.
--   ⚠️★더 나쁜 것 — ★RS 의 재시도는 ★`req` 단위라 ★POST 중복 위험이 ★남는다고
--   ★코드 주석이 ★스스로 적어 두었다(`:891-905`).
--
-- [★무엇이 달라지나]
--   종전: DELETE x(2 또는 3)  +  POST x수십(청크 500/1000)  +  PATCH meta
--   현행: POST /rpc/rs_weekly_replace x1   = ★요청 1 · ★공백 창 ★0
--
-- [⚠️★선례와 ★다른 점 3가지 — ★그대로 베끼면 틀린다]
--   ★1. ★삭제 범위가 ★전표가 아니라 ★시장별이다(`where market = any($markets)`).
--      ★그래서 ★검산을 ★`count(*) from 표` 로 할 수 ★없다 — ★다른 시장 행이 섞인다.
--      ★★대신 ★`get diagnostics row_count` 로 ★이번에 ★넣은 행수를 돌려준다.
--   ★2. ★컬럼 목록을 ★손으로 적지 ★않는다 — ★★아래 「동적 컬럼」 절 참조.
--   ★3. ★`rs_universe_weekly` 는 ★`--full-universe` 일 때만 ★범위에 든다.
--      ⚠️★파이썬 종전 동작은 ★`universe_rows is not None` 이면 ★DELETE 하고
--      ★`if universe_rows:` 일 때만 ★POST 한다 — ★즉 ★★`--full-universe` 인데
--      ★행이 0이면 ★그 시장 universe 를 ★비운다. ★그 동작을 ★그대로 보존하려고
--      ★★`universe_scope` 를 ★행 유무와 ★별개 플래그로 받는다.
--
-- [★★동적 컬럼 — ★왜 선례처럼 목록을 ★못 적나]
--   ★이유 둘:
--     ★① ★`rs_top_weekly`·`rs_history_weekly` 의 ★기본 DDL 이 ★이 저장소에 ★없다.
--        ★`supabase/schema.sql` 에도 ★없고 ★`rs_universe.sql` 은 ★universe 만 만든다.
--        ★두 표는 ★Supabase SQL Editor 에서 ★직접 만들어졌다(★파일로 남지 않았다).
--        ★★목록을 손으로 적으면 ★그것은 ★추측이다.
--     ★② ★파이썬이 ★`_columns_exist()` 로 ★컬럼 존재를 ★probe 해 ★없으면 ★그 키를
--        ★행에서 ★뺀다(ALTER 전에도 적재가 안 깨지게). ★★RPC 가 ★고정 목록을 쓰면
--        ★그 degrade 가 ★사라져 ★ALTER 가 밀린 DB 에서 ★통째로 실패한다.
--   ★★그래서 ★「페이로드 키의 합집합」 ∩ ★「표에 실재하는 쓰기가능 컬럼」으로
--   ★INSERT 목록을 ★매번 만든다. ★이것이 ★PostgREST 의 동작과 ★같다.
--   ★`jsonb_populate_recordset(null::<표>, …)` 가 ★타입을 ★표에서 가져오므로
--   ★타입도 ★손으로 적지 않는다.
--   ⚠️★★`attidentity`·`attgenerated` 를 ★제외한다 — ★identity·생성 컬럼에 쓰면 실패한다.
--
-- [⚠️★되돌리기]
--   ★`S2_RS_RPC=0`(★기본값) ★한 줄이면 ★파이썬이 ★종전 경로를 탄다(이 함수를 ★안 부른다).
--   ★함수를 지우려면: drop function if exists public.rs_weekly_replace(jsonb);
--   ⚠️★이 마이그레이션은 ★함수만 만든다 — ★표·컬럼·제약·정책을 ★하나도 건드리지 않는다.
--
-- [⚠️★보안]
--   ★security definer — ★RLS 를 우회해 쓰기 위해서다(종전 service_role 키와 ★같은 권한).
--   ★`search_path` 를 ★고정해 ★주입을 막고 ★anon·authenticated 의 EXECUTE 를 ★뺀다.
--
-- [⚠️★pg_safeupdate]
--   ★Supabase 는 ★WHERE 없는 DELETE 를 ★거부한다(`21000`). ★선례가 ★첫 적재에서
--   ★그것에 걸려 ★`where true` 를 ★추가해야 했다. ★여기 DELETE 는 ★전부
--   ★`where market = any(...)` 이므로 ★그 함정에 ★걸리지 않는다.
--
-- [⚠️★페이로드 크기]
--   ★`--full-universe` 는 ★universe 행이 ★가장 크다(★56주 x 시총통과 종목).
--   ★실측 → 위 md §5. ★파이썬이 ★`S2_RS_RPC_GZIP=1` 로 ★gzip 전송할 수 있다.
--   ★`statement_timeout` 을 ★300s 로 올린다 — ★선례(180s)보다 ★긴 이유는
--   ★동적 키 합집합 1패스 + ★최대 표가 ★EOD 보다 크기 때문이다.
--
-- [⚠️★이 함수가 ★하지 않는 것]
--   ★★「행이 0이면 삭제를 거부」하는 ★공백 가드는 ★넣지 않았다 — ★종전 동작을
--   ★바꾸지 않는 것이 ★이 후보의 범위다. ★원자성은 ★「부분 공백」을 없애지만
--   ★★「상류가 0행을 만들어 보낸 경우」는 ★여전히 ★표를 비운다.
--   ★그 축은 ★별 후보다(md §0-2).
-- =====================================================================

create or replace function public.rs_weekly_replace(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_markets text[];
  v_uscope  boolean;
  v_last    text := payload->>'last_rs_weekly_at';
  v_dtop    bigint := 0;
  v_dhist   bigint := 0;
  v_duniv   bigint := 0;
  v_ins     jsonb  := '{}'::jsonb;
  v_rows    jsonb;
  v_keys    text[];
  v_cols    text;
  v_n       bigint;
  v_tbl     text;
  v_out     jsonb;
begin
  -- ★역할 기본값에 의존하지 않는다. ★SET LOCAL = 이 트랜잭션 한정.
  set local statement_timeout = '300s';

  -- ── ① 삭제 범위를 ★페이로드가 ★명시한다 ────────────────────────────
  --   ⚠️★행에서 ★유도하지 않는다 — ★0행인 시장도 ★종전처럼 ★비워야 하므로
  --     ★범위는 ★호출자(파이썬 `markets` 집합)가 ★정한다.
  v_markets := array(select jsonb_array_elements_text(
                              coalesce(payload->'markets', '[]'::jsonb)));
  if v_markets is null or cardinality(v_markets) = 0 then
    raise exception
      '[rs_weekly_replace] markets 가 비었다 — 삭제 범위를 정할 수 없다';
  end if;
  v_uscope := coalesce((payload->>'universe_scope')::boolean, false);

  -- ★범위 밖 market 행을 ★거부한다 — ★「삭제 없이 추가만」 되는 ★비대칭을 막는다.
  if exists (
      select 1 from (
        select distinct e.value->>'market' as mk
          from jsonb_array_elements(coalesce(payload->'rs_top_weekly',
                                             '[]'::jsonb)) e
        union
        select distinct e.value->>'market'
          from jsonb_array_elements(coalesce(payload->'rs_history_weekly',
                                             '[]'::jsonb)) e
        union
        select distinct e.value->>'market'
          from jsonb_array_elements(coalesce(payload->'rs_universe_weekly',
                                             '[]'::jsonb)) e
      ) q
      where q.mk is null or q.mk <> all(v_markets)
  ) then
    raise exception
      '[rs_weekly_replace] payload 에 삭제 범위(%) 밖의 market 행이 있다',
      array_to_string(v_markets, ',');
  end if;

  -- ★universe 행을 보냈는데 ★범위가 아니면 ★조용히 버리지 않는다.
  if not v_uscope
     and jsonb_array_length(coalesce(payload->'rs_universe_weekly',
                                     '[]'::jsonb)) > 0 then
    raise exception
      '[rs_weekly_replace] universe_scope=false 인데 rs_universe_weekly 행이 %건 왔다',
      jsonb_array_length(payload->'rs_universe_weekly');
  end if;

  -- ── ② 전삭제 — ★같은 트랜잭션 안이다. ★독자는 ★중간 상태를 ★볼 수 없다 ──
  --   ★TRUNCATE 가 아니라 DELETE 인 이유 — TRUNCATE 는 ★ACCESS EXCLUSIVE 락이라
  --   ★읽기까지 막는다. ★DELETE 는 ★MVCC 로 ★종전 스냅샷을 보여준다.
  --   ★여기 DELETE 는 ★전부 WHERE 가 있다(pg_safeupdate 통과 · 위 주석).
  delete from public.rs_top_weekly     where market = any(v_markets);
  get diagnostics v_dtop = row_count;
  delete from public.rs_history_weekly where market = any(v_markets);
  get diagnostics v_dhist = row_count;
  if v_uscope then
    delete from public.rs_universe_weekly where market = any(v_markets);
    get diagnostics v_duniv = row_count;
  end if;

  -- ── ③ 재적재 — ★동적 컬럼(위 「동적 컬럼」 절) ────────────────────────
  foreach v_tbl in array array['rs_top_weekly',
                               'rs_history_weekly',
                               'rs_universe_weekly']
  loop
    if v_tbl = 'rs_universe_weekly' and not v_uscope then
      continue;
    end if;

    v_rows := coalesce(payload->v_tbl, '[]'::jsonb);
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception '[rs_weekly_replace] payload.% 가 배열이 아니다 (%)',
        v_tbl, jsonb_typeof(v_rows);
    end if;
    if jsonb_array_length(v_rows) = 0 then
      v_ins := v_ins || jsonb_build_object(v_tbl, 0);
      continue;
    end if;

    -- ★키 합집합 — ★첫 행만 보지 않는다.
    --   ★PostgREST 는 ★키가 ★불균질한 bulk insert 를 ★거부하므로 ★종전 경로가
    --   ★돌았다면 ★균질하다. ★그래도 ★합집합이 ★엄밀히 안전하다(1패스).
    select array_agg(distinct kk.k)
      into v_keys
      from jsonb_array_elements(v_rows) e,
           jsonb_object_keys(e.value) as kk(k);

    -- ★표에 ★실재하는 ★쓰기가능 컬럼과의 교집합. ★순서는 ★표 컬럼 순(attnum).
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid     = ('public.' || quote_ident(v_tbl))::regclass
       and a.attnum       > 0
       and not a.attisdropped
       and a.attidentity  = ''
       and a.attgenerated = ''
       and a.attname::text = any(v_keys);

    if v_cols is null then
      raise exception
        '[rs_weekly_replace] %: 페이로드 키와 표 컬럼의 교집합이 0 이다 (키 %)',
        v_tbl, array_to_string(v_keys, ',');
    end if;

    execute format(
      'insert into public.%I (%s) '
      'select %s from jsonb_populate_recordset(null::public.%I, $1)',
      v_tbl, v_cols, v_cols, v_tbl)
      using v_rows;
    get diagnostics v_n = row_count;

    -- ⚠️★조용한 부분 적재를 ★막는다 — ★보낸 수와 ★넣은 수가 ★같아야 한다.
    if v_n <> jsonb_array_length(v_rows) then
      raise exception
        '[rs_weekly_replace] %: 보낸 %건 중 %건만 적재됐다',
        v_tbl, jsonb_array_length(v_rows), v_n;
    end if;
    v_ins := v_ins || jsonb_build_object(v_tbl, v_n);
  end loop;

  -- ── ④ 완료 신호도 ★같은 트랜잭션 안이다 ──────────────────────────────
  --   ⚠️★종전은 ★마지막 PATCH 라 ★그 앞에서 죽으면 ★「빈 표 + 낡은 meta」였다.
  --   ★값은 ★파이썬이 만든 ★그 시각 문자열을 ★그대로 쓴다(★DB 시계가 아니다) —
  --     ★종전 PATCH 와 ★같은 값이 들어가게.
  --   ★★종전과 ★다른 점 1개 — ★`updated_at` 이 ★갱신된다.
  --     ★PATCH 는 `value` 만 보내 ★`updated_at` 이 ★안 움직였다(default 는 insert 때만).
  --     ★여기서는 ★now() 로 ★같이 움직인다 — ★완료 시각을 ★믿을 수 있게.
  if v_last is not null then
    insert into public.meta (key, value, updated_at)
    values ('last_rs_weekly_at', to_jsonb(v_last), now())
    on conflict (key) do update
      set value = excluded.value, updated_at = now();
  end if;

  -- ── ⑤ 결과를 ★행수로 돌려준다 ─────────────────────────────────────────
  --   ⚠️★호출자는 ★rc 가 아니라 ★이 숫자로 검산한다
  --     (★2026-09-25 의 교훈 — `rc` 가 ★내용을 보증하지 않는다).
  select jsonb_build_object(
    'markets',           to_jsonb(v_markets),
    'universe_scope',    v_uscope,
    'deleted',           jsonb_build_object(
                           'rs_top_weekly',      v_dtop,
                           'rs_history_weekly',  v_dhist,
                           'rs_universe_weekly', v_duniv),
    'inserted',          v_ins,
    'last_rs_weekly_at', v_last
  ) into v_out;

  return v_out;
end;
$fn$;

-- ★공개 역할에서 실행 권한을 뺀다 — ★service_role 만 부른다.
revoke all on function public.rs_weekly_replace(jsonb) from public;
revoke all on function public.rs_weekly_replace(jsonb) from anon;
revoke all on function public.rs_weekly_replace(jsonb) from authenticated;
grant execute on function public.rs_weekly_replace(jsonb) to service_role;

comment on function public.rs_weekly_replace(jsonb) is
  'RS 주간 3표(rs_top_weekly / rs_history_weekly / rs_universe_weekly) 시장별 단일 트랜잭션 적재 (CAND-2026-10-19-45). 실패 시 ROLLBACK 이라 종전 데이터가 남는다. 되돌리기 = S2_RS_RPC=0.';
