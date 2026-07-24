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

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') kr_perf_weekly start =====" | Out-File -Append -Encoding utf8 $log

# 종료일 = 일봉 캐시에 실제로 존재하는 마지막 거래일 (진실의 원천).
# 휴장일(예: 2026-07-17)을 몰라도, 데이터가 있는 곳까지만 돌므로 헛수집이 없다.
# 금 18:00 S2_rs_kr_jp 가 캐시를 갱신하면 그 최신일이 자동 반영된다.
$lastDay = & "$qb\venv\Scripts\python.exe" "$qb\market_calendar.py" KR-DATA 2>$null
if (-not $lastDay) {
    Log "[ABORT] 캐시 마지막 거래일 조회 실패"; exit 1
}
# 종료일 = 캐시 마지막 거래일 + 3일. RS 테이블 주차 인덱스에 시각(예: 16:38:32)이
# 붙어 있어, 같은 날 00:00 상한으로는 그 주차가 <= 비교에서 빠진다. +3일 여유로 확실히 포함.
# NO_FETCH=1 이므로 미래 종료일이어도 실제 데이터/RS 테이블이 있는 곳까지만 돈다.
$lastDay = $lastDay.Trim()
$endDate = ([DateTime]$lastDay).AddDays(3).ToString("yyyy-MM-dd")
Log "백테스트 종료일: $endDate (일봉 캐시 마지막 거래일 $lastDay + 3, RS주차 시각오프셋 여유)"

# 채택 구성 env (kr16_half_ef 동일 · 캐시 읽기전용, 신규 수집 없음)
$env:BT_READONLY_CACHE = "1"
$env:BT_NO_FETCH = "1"
$env:BT_OUTPUT_DIR = "$qb\screen"
$env:BT_MARKET = "2"
$env:BT_START_DATE = "2016-01-01"
$env:BT_END_DATE = $endDate
$env:BT_ENTRY_MODE = "immediate"
$env:BT_MARKET_FILTER = "1"
$env:BT_MFILTER_MODE = "half"
$env:BT_MKTCAP_TOP_PCT = "0.20"
$env:BT_ATR_SIZING_ENABLED = "1"
$env:BT_RISK_PER_TRADE = "0.007"
$env:BT_COOLDOWN_WEEKS = "8"
$env:BT_DISABLE_CA_FILTER = "0"
$env:BT_EARNINGS_CACHE_KR = "_bt_earnings_cache_kr_dart_op.pkl"
$env:BT_CA_REQUIRE = "C"
$env:BT_C_MIN_GROWTH = "0.25"
$env:BT_ENTRY_FILTER = "1"
$env:BT_RESULT_SUFFIX = "kr16_perf_live"

Set-Location $qb
Log "[1 backtest] start"
& "$qb\venv\Scripts\python.exe" "$qb\17_88_cmp_sf1.py" *>> $log
Log "[1 backtest] done (exit=$LASTEXITCODE)"
if ($LASTEXITCODE -ne 0) { Log "[ABORT] 백테스트 실패 — JSON 갱신 생략"; exit 1 }

Log "[2 build json] start"
& "$qb\venv\Scripts\python.exe" "$qb\build_kr_perf_json.py" *>> $log
Log "[2 build json] done (exit=$LASTEXITCODE)"
if ($LASTEXITCODE -ne 0) { Log "[ABORT] JSON 생성 실패 — push 생략"; exit 1 }

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
"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') kr_perf_weekly done =====" | Out-File -Append -Encoding utf8 $log
