# 매주 토요일 08:00 KST — 성과(KR) 페이지 주간 갱신 (rs96.vercel.app/performance).
#
# 금 18:00 S2_rs_kr_jp 가 KR 캐시를 갱신한 뒤, 채택 구성(kr16_half_ef = 영업이익 C≥25%
# + 거래대금 상위20% + M필터 half + 진입 4-필터 + ATR 0.7%)의 백테스트를 지난 금요일
# 마감까지 연장 실행 → rs96Perf.json 재생성 → git push (Vercel 자동 배포).
# 종료일 = 지난 금요일 + 1일 (KR RS 테이블 마지막 주차 인덱스에 시각이 붙는 문제 회피).

$ErrorActionPreference = "Continue"
$log = Join-Path $PSScriptRoot "kr_perf_weekly.log"
$qb  = "C:\quantBacktest"
$web = (Get-Item $PSScriptRoot).Parent.FullName
$env:PYTHONUTF8 = "1"

function Log($m) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -Append -Encoding utf8 $log
}

# [2026-08-16 랙 수리] 텔레그램 RS 채널 알림 헬퍼 — 침묵 실패 관문용.
#   4주간(07-25 – 08-15) 원장이 07-17 에 동결됐는데 잡 exit 0 완주라 무감지였다
#   (근거: quant_infra/2026-08/RS_LEDGER_LAG_2026-08-16.md §0). 승인: 해달별님 2026-08-16 「전체 패키지」
#   되돌리기: 이 블록(변수 1개 · 함수 1개)과 아래 Notify 호출부 전부 삭제.
$notifyPy = Join-Path $PSScriptRoot "notify_rs_telegram.py"
function Notify($msg) {
    try { & "$qb\venv\Scripts\python.exe" $notifyPy $msg *>> $log } catch { Log "[notify] FAILED: $_" }
}
# [2026-08-16 랙 수리] 끝

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') kr_perf_weekly start =====" | Out-File -Append -Encoding utf8 $log

# [2026-08-16 랙 수리] endDate 산식 교체: 「캐시 max + 3일」 → 실행일(오늘).
#   구 산식은 순환 데드락 — 캐시가 동결되면 endDate = 캐시 max(07-16)+3 = 07-19(일)로
#   다음 거래일 07-20 이 영원히 창 밖이라, fetch 를 켜도 07-16 에 고정된다
#   (근거: quant_infra/2026-08/RS_LEDGER_LAG_2026-08-16.md §0 「순환 데드락」).
#   실행일 상한이어도 안전한 이유: ①BT_NO_FETCH=1 이라 데이터가 있는 곳까지만 돈다(구 주석과
#   동일 논리) ②RS 주차 인덱스의 시각 오프셋(금 16:38 등)도 토 08:00 실행일 00:00 상한이
#   항상 포함한다(금 < 토 00:00). 승인: 해달별님 2026-08-16 「전체 패키지」
#   되돌리기: 아래 신 2줄을 지우고 다음 구 산식 블록의 주석을 해제.
#   ── 구 산식 (원문 보존) ──────────────────────────────────────────────
#   # 종료일 = 일봉 캐시에 실제로 존재하는 마지막 거래일 (진실의 원천).
#   # 휴장일(예: 2026-07-17)을 몰라도, 데이터가 있는 곳까지만 돌므로 헛수집이 없다.
#   # 금 18:00 S2_rs_kr_jp 가 캐시를 갱신하면 그 최신일이 자동 반영된다.
#   $lastDay = & "$qb\venv\Scripts\python.exe" "$qb\market_calendar.py" KR-DATA 2>$null
#   if (-not $lastDay) {
#       Log "[ABORT] 캐시 마지막 거래일 조회 실패"; exit 1
#   }
#   # 종료일 = 캐시 마지막 거래일 + 3일. RS 테이블 주차 인덱스에 시각(예: 16:38:32)이
#   # 붙어 있어, 같은 날 00:00 상한으로는 그 주차가 <= 비교에서 빠진다. +3일 여유로 확실히 포함.
#   # NO_FETCH=1 이므로 미래 종료일이어도 실제 데이터/RS 테이블이 있는 곳까지만 돈다.
#   $lastDay = $lastDay.Trim()
#   $endDate = ([DateTime]$lastDay).AddDays(3).ToString("yyyy-MM-dd")
#   Log "백테스트 종료일: $endDate (일봉 캐시 마지막 거래일 $lastDay + 3, RS주차 시각오프셋 여유)"
#   ─────────────────────────────────────────────────────────────────────
$endDate = (Get-Date).ToString("yyyy-MM-dd")
Log "백테스트 종료일: $endDate (실행일 — 2026-08-16 랙 수리로 산식 교체 · 구 산식은 캐시 동결 시 순환 데드락)"
# [2026-08-16 랙 수리] 끝

# 채택 구성 env (kr16_half_ef 동일 · 캐시 읽기전용, 신규 수집 없음)
$env:BT_READONLY_CACHE = "1"
$env:BT_NO_FETCH = "1"
$env:BT_OUTPUT_DIR = "$qb\screen"
# [2026-08-16 랙 수리] KR 일봉 캐시를 연장본(live)으로 지정 — 17_88_cmp_sf1.py:106 이 이 env 를
#   읽는다(기본값 _bt_daily_cache_kr.pkl · 07-24 이후 동결). live 는 금 17시대 S2_rs_kr_jp 의
#   신설 단계 [0](append_kr_daily_cache.py)이 매주 연장한다.
#   되돌리기: 아래 1줄 삭제(기본값 원본 복귀).
$env:BT_DAILY_CACHE_KR = "_bt_daily_cache_kr_live.pkl"
# [2026-08-16 랙 수리] 끝
$env:BT_MARKET = "2"
$env:BT_START_DATE = "2016-01-01"
$env:BT_END_DATE = $endDate
$env:BT_ENTRY_MODE = "immediate"
$env:BT_MARKET_FILTER = "1"
$env:BT_MFILTER_MODE = "half"
$env:BT_MKTCAP_TOP_PCT = "0.20"
$env:BT_ATR_SIZING_ENABLED = "1"
# ★★★2026-08-09 채택 — 후보 C (RS_ENTRY 90 · RS_EXIT 83 · RISK 0.010 · 무차입 1.0)
#   되돌리기: 아래 4줄을 지우면 완전히 원복된다(BT_RISK_PER_TRADE 는 0.007 로 되돌릴 것).
#   [홀드아웃] 결정창(–2024)에서만 파라미터를 정하고, 2025 로 붕괴를 보고,
#     합격선(전구간 Calmar >= 0.7063 또는 MDD >= -30%)과 예측을 **개봉 전 문서에 박은 뒤**
#     2026 을 딱 1회 열었다 → Calmar 0.9391 ✅ · MDD -24.88% ✅ (두 조건 모두 충족)
#   [전구간 2016-01-01 – 2026-07-17 · 무차입] CAGR 14.07 → 23.37% · Calmar 0.6522 → 0.9391 · 거래 383 → 455
#   [게이트 off 재현 검증 완료] BT_RS_ENTRY 미설정 = 96 = 현행(383거래 · 14.0720 · -21.5773 · 0.6522)
#   ⚠️2026 **단독**에서는 현행이 더 좋았다(+60.67% vs +51.57%) — 레짐 의존. 인용 시 병기할 것
#   근거: quant_infra/2026-08/KR_RS96_ADOPT_C_2026-08-09.md
$env:BT_RS_ENTRY = "90"          # ★엔진 기본 96 (17_88_cmp_sf1.py:115 env 게이트 신설)
$env:BT_RS_EXIT = "83"           # ★엔진 기본 87
$env:BT_MAX_EXPOSURE = "1.0"     # ★엔진 기본 1.3 → 무차입 (레버는 13 entry 중 12개에서 열위)
$env:BT_RISK_PER_TRADE = "0.010" # ★기존 0.007 → 0.010 (사이징이 레버보다 효과 4.2배)
$env:BT_COOLDOWN_WEEKS = "8"
$env:BT_DISABLE_CA_FILTER = "0"
$env:BT_EARNINGS_CACHE_KR = "_bt_earnings_cache_kr_dart_op.pkl"
$env:BT_CA_REQUIRE = "C"
$env:BT_C_MIN_GROWTH = "0.25"
$env:BT_ENTRY_FILTER = "1"
# ★★2026-08-12 — 트레일 4단 → 2단 (해달별님 채택). 아래 4줄 주석 처리.
#   되돌리기: 아래 4줄의 주석(#)만 제거하면 4단으로 완전 복원된다.
#
#   [근거] 결정창·전 구간 모두에서 Calmar 기준 2단 우세
#     KR 결정창 24셀 주효과 ΔCalmar(4단−2단) = −0.0088
#     KR 전 구간(2016-01-01 – 2026-07-31) 4단 23.3353/−25.8398/0.9031
#                                          2단 23.8092/−25.1089/★0.9482  (ΔCalmar −0.0451)
#   [기제] KR 은 100EMA 8건 · 75EMA 10건으로 초대형 승자가 US 보다 오히려 많다.
#     ★그런데도 2단이 나은 이유는 **되돌림이 커서 50EMA 에서 잘라도 충분히 벌기** 때문이다.
#     2023: 4단 +95.30% vs 2단 ★+111.85% (−16.55%p) · 2021 −5.16%p · 2025 −5.39%p
#   ⚠️미검증: 블록 부트스트랩 없음 · F4(저점일) 사건교체로 MDD 비교 무효
#   전문: quant_infra/2026-08/RS_KR_GRID24_2026-08-12.md §5
#
# 고수익 트레일 4단 (21→50→75→100): +100%→75EMA, +200%→100EMA (2026-08-02 확정)
# $env:BT_HIGAIN_EMA = "75"
# $env:BT_HIGAIN_WMA_PCT = "100"
# $env:BT_HIGAIN2_EMA = "100"
# $env:BT_HIGAIN2_PCT = "200"
$env:BT_RESULT_SUFFIX = "kr16_perf_live"

Set-Location $qb
Log "[1 backtest] start"
& "$qb\venv\Scripts\python.exe" "$qb\17_88_cmp_sf1.py" *>> $log
Log "[1 backtest] done (exit=$LASTEXITCODE)"
# [2026-08-16 랙 수리] 기존 ABORT 에 텔레그램 알림 추가 (되돌리기: Notify 줄만 삭제)
if ($LASTEXITCODE -ne 0) {
    Log "[ABORT] 백테스트 실패 — JSON 갱신 생략"
    Notify "[kr_perf_weekly] 백테스트 실패(exit=$LASTEXITCODE) — 잡 중단. 로그: kr_perf_weekly.log"
    exit 1
}
# [2026-08-16 랙 수리] 끝

Log "[2 build json] start"
& "$qb\venv\Scripts\python.exe" "$qb\build_kr_perf_json.py" *>> $log
Log "[2 build json] done (exit=$LASTEXITCODE)"
# [2026-08-16 랙 수리] 기존 ABORT 에 텔레그램 알림 추가 (되돌리기: Notify 줄만 삭제)
if ($LASTEXITCODE -ne 0) {
    Log "[ABORT] JSON 생성 실패 — push 생략"
    Notify "[kr_perf_weekly] JSON 생성 실패(exit=$LASTEXITCODE) — 잡 중단. 로그: kr_perf_weekly.log"
    exit 1
}
# [2026-08-16 랙 수리] 끝

Set-Location $web
$diff = git status --porcelain lib/rs96Perf.json
if ($diff) {
    git add lib/rs96Perf.json *>> $log
    git commit -m "성과(KR) 주간 갱신: $endDate 마감 반영 (자동)" *>> $log
    git push *>> $log
    Log "[3 deploy] pushed"
} else {
    Log "[3 deploy] 변경 없음 — push 생략"
}

# [2026-08-16 랙 수리] [3b gap check] 사후 격차 관문 — 산출 원장 KR_자산 마지막 date 와
#   직전 금요일의 격차 > 7일이면 텔레그램 알림 + exit 1 (스케줄러 Last Result 로도 보이게).
#   실측 사고: 07-25 – 08-15 4런이 전부 last=07-17 동결인데 exit 0 완주라 4주 무감지
#   (RS_LEDGER_LAG_2026-08-16.md §0 「침묵 요인」). 배포 뒤에 두는 이유: 랙이면 JSON 이
#   변하지 않아 push 도 자연히 생략되므로, 검사 자체의 오탐이 정상 배포를 막지 않게 한다.
#   되돌리기: 이 블록 전체 + scripts/check_kr16_ledger_gap.py 삭제.
Log "[3b gap check] start"
& "$qb\venv\Scripts\python.exe" (Join-Path $PSScriptRoot "check_kr16_ledger_gap.py") *>> $log
Log "[3b gap check] done (exit=$LASTEXITCODE)"
if ($LASTEXITCODE -ne 0) {
    Log "[ABORT] 원장 랙 감지 — exit 1"
    Notify "[kr_perf_weekly] 원장 랙 감지 — KR_자산 마지막 date 가 직전 금요일보다 7일 초과 지연. 로그: kr_perf_weekly.log"
    "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') kr_perf_weekly done (LAG FAIL) =====" | Out-File -Append -Encoding utf8 $log
    exit 1
}
# [2026-08-16 랙 수리] 끝
"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') kr_perf_weekly done =====" | Out-File -Append -Encoding utf8 $log
