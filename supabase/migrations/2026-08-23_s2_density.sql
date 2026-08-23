-- ★★과밀일 페이지 데이터 — s2_density 테이블 신설 (해달별님 결정 2026-08-23 · B안)
--
-- [왜] 「과밀일 페이지가 ★일별로 갱신되도록 스케줄러에 포함되었으면 한다」(해달별님).
--      ★A안(정적 JSON + 매일 자동 커밋·push)과 ★B안(Supabase 적재 + 동적 페이지) 중
--      ★B를 골랐다 — ★매일 무인 push 는 되돌리기 어려운 외부 행위를 반복하고,
--      ★실패해도 화면만 낡아 ★조용한 실패가 된다(2026-08-23 하루에 그 유형 사고 2건).
--      ★B는 나머지 페이지와 ★같은 경로(Supabase)를 쓰고 ★재빌드가 필요 없다.
--
-- [무엇이 들어오나 — ★구현 정의]
--      한 행 = 하루. n = 그날 ★진입 후보 수.
--      ★후보 1건 = 그날 ①MA20 이 있고 ②최근 20일 최대 거래대금 ≥ 5,000억
--        ③종가 < MA20 x 0.80 인 ★종목-일.
--      ★update_env_density.py:build() 의 dens 와 ★같은 식이다
--        (익스포터가 그 모듈에서 ★상수째 import 하므로 정의가 어긋날 수 없다).
--      ★crowded = 그 건수의 15거래일 롤링 합(t−1 까지)이 확장 분위 상위 TOPQ(0.0425)를 넘는 날.
--        그날은 진입 문턱이 0.20 → 0.15 로 완화된다(2026-08-22 채택).
--
-- [누가 채우나] run_eod.ps1 의 신규 단계 export_density.py
--      ★순서 계약 — update_env_density.py ★뒤에 둔다(같은 맵·같은 TOPQ 를 쓴다).
--      ★실패해도 rc=0(체인을 안 끊는다) — 대신 사이드카와 로그에 남긴다.
--
-- ⚠️[안 들어오는 것] ★연도별 성과(CAGR·연내 MDD)는 ★여기 없다.
--      ★백테스트 1런(약 65초)이 필요하고 ★매일 돌리면 2026 홀드아웃을 매일 다시 여는 모양이 된다(§4-4).
--      ★성과는 정적 스냅샷으로 두고 ★채택이 바뀔 때만 갱신한다.
--
-- [되돌리기] 아래 rollback 블록 참조.

create table if not exists s2_density (
  d         date    primary key,          -- 거래일
  n         integer not null,             -- 그날 진입 후보 수(종목-일)
  crowded   boolean not null default false, -- 과밀일인가(진입 문턱 완화)
  roll15    integer,                      -- 15거래일 롤링 합(t−1 까지). 워밍업 구간은 null
  thr       numeric(8,1),                 -- 그날의 과밀 문턱. 워밍업 구간은 null
  created_at timestamptz not null default now()
);

create index if not exists s2_density_crowded_idx on s2_density (crowded) where crowded;

alter table s2_density enable row level security;

drop policy if exists "public read" on s2_density;
create policy "public read" on s2_density for select using (true);

-- ── 확인 (실행 후 붙여넣어 본다) ──────────────────────────────────
-- select count(*) as days,
--        count(*) filter (where crowded) as crowded_days,
--        min(d) as first_d, max(d) as last_d,
--        sum(n) as total_n, max(n) as max_n
--   from s2_density;
-- → 적재 전이면 전부 0/null 이다. export_density.py 를 돌린 뒤 다시 본다.

-- ── rollback (과밀일 페이지를 걷어낼 때) ─────────────────────────
-- ⚠️★순서 — 먼저 run_eod.ps1 에서 export_density.py 줄을 지우고,
--    웹앱에서 /crowded 라우트를 뺀 뒤에 테이블을 지운다.
--    ★순서를 바꾸면 EOD 나 화면이 깨진다.
--
-- drop policy if exists "public read" on s2_density;
-- drop table if exists s2_density;
