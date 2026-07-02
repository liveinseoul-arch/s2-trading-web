# S2 트레이딩 따라하기 (S2 Trading Companion)

검증된 **S2 매매 시스템(주도주 급락 눌림목 매매)**의 규칙대로 매매하려는 사람을 돕는 **정보 제공 웹 서비스**.
장마감 전 동시호가 주문 정보, 일자별 매수/매도 종목, 월별 성과 대시보드, 종목별 매매 이력을 제공한다.

> ⚠️ **본 서비스는 투자 정보·교육 목적이며 투자 권유나 자문이 아닙니다.** 모든 수치는 기준 모델 포트폴리오의
> 시뮬레이션 결과이고, 과거 성과는 미래를 보장하지 않습니다. 실제 매매·손익 책임은 전적으로 이용자 본인에게 있습니다.+

---

## 핵심 설계 원칙

**검증된 S2 매매 로직을 TypeScript로 재구현하지 않는다.** 기존 Python 엔진(`../s2_candidates.py`, `../backtest.py`)을
"계산 엔진 = 진실의 원천(source of truth)"으로 두고, 그 결과(후보·체결·보유·거래·월별 통계)를 Supabase에 적재한다.
Next.js 앱은 Supabase를 읽어 보여주는 **읽기 중심 표현 계층(read-only presentation layer)**이다.
→ 전략 일관성 보장, 로직 중복/표류(drift) 방지, 백테스트와 라이브가 동일 엔진 사용.

```
[KRX / pykrx]
     │  (장중 스냅샷 / 일봉)
     ▼
[Python S2 엔진 + Exporter]  ──(service_role, write)──▶  [Supabase Postgres]
  s2_candidates.py / backtest.py                              │
  scripts/export_*.py                          (anon, read-only · RLS) │
                                                                ▼
                                          [Next.js App Router @ Vercel]  ──▶  사용자(모바일/웹)
```

## 서비스 범위 (MVP 확정)

- **공개 단일 기준 포트폴리오** — 로그인 없음. 누구나 보는 하나의 기준 S2 모델 포트폴리오(기준자본 **5억원**).
- **포트% 기본 + 선택적 자본입력 환산** — 모든 사이징은 포트 대비 %(15/12/7.5/6)로 저장·표시.
  사용자가 자기 자본을 입력하면 클라이언트(브라우저)에서 주문 수량/금액으로 환산(서버 데이터는 % 그대로).

## 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js 15 (App Router) + React 19 |
| 언어 | TypeScript |
| 스타일 | Tailwind CSS v4 |
| DB / 백엔드 | Supabase (Postgres + RLS) |
| 배포 | Vercel |
| 계산 엔진 | Python 3.14 (기존 S2 엔진 재사용) |
| 스케줄링 | GitHub Actions cron (권장) / 로컬 Task Scheduler (Phase 1) |

## 모노레포 구조

```
s2_method/                     # (기존) Python S2 엔진 — 진실의 원천
├─ s2_candidates.py            #   후보 추출 / --verify 사후 검증
├─ backtest.py, config.py …
└─ s2-trading-web/             # (신규) 웹 서비스
   ├─ README.md                #   이 문서
   ├─ docs/                    #   설계 문서 (아래 인덱스)
   ├─ scripts/                 #   Python → Supabase 적재 스크립트(Phase 1에서 작성)
   │   ├─ export_eod.py        #     장마감 후: verify → executions/positions/trades/nav/monthly
   │   └─ export_preclose.py   #     장마감 전: 후보 → daily_candidates (Phase 2)
   ├─ supabase/
   │   └─ schema.sql           #   DB 스키마 (docs/02 참조)
   └─ app/, components/, lib/  #   Next.js (Phase 1에서 작성)
```

## 문서 인덱스

| 문서 | 내용 |
|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | 시스템 아키텍처 · 데이터 파이프라인 · 스케줄링 · 배포 · 환경변수 |
| [docs/02-data-model.md](docs/02-data-model.md) | Supabase 스키마(DDL) · RLS · 테이블별 의미 |
| [docs/03-screens.md](docs/03-screens.md) | 화면(라우트)별 기능 명세 · 컴포넌트 · 모바일 |
| [docs/04-design-system.md](docs/04-design-system.md) | 디자인 시스템 · 색상(한국식 빨강=상승) · 타이포 · 컴포넌트 |
| [docs/05-roadmap.md](docs/05-roadmap.md) | 단계별 개발 계획 · MVP 범위 · 마일스톤 |
| [docs/06-order-management.md](docs/06-order-management.md) | 주문 라이프사이클 · 감시주문 플랜(매수/매도/손절) · 텔레그램 알림 |

## 빠른 시작 (개발 — Phase 1에서 구현)

```bash
# 1) 웹 앱 스캐폴드
cd s2-trading-web
npx create-next-app@latest . --ts --tailwind --app --eslint

# 2) 환경변수 (.env.local)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# 3) Supabase 스키마 적용
#   supabase/schema.sql 을 Supabase SQL Editor에 붙여넣어 실행

# 4) Python exporter 환경변수 (../.env.local 재사용 + 추가)
KRX_ID=... / KRX_PW=...            # 기존
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...      # 쓰기 전용(서버에서만, 절대 클라이언트 노출 금지)

# 5) 적재 1회 수동 실행
python scripts/export_eod.py --backfill 2019-03-11:2026-05-27

# 6) 개발 서버
npm run dev
```

현재 단계: **Phase 0 — 설계/문서**. 코드 스캐폴딩은 설계 승인 후 Phase 1에서 진행한다.
