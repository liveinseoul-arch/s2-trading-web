# 매주 토요일 09:30 KST — 성과(JP) 무료 주간 갱신 (rs96.vercel.app/jp-backtest).
#
# yfinance 무료 증분(과거 J-Quants 스냅샷 + 최근 증분) → 채택 구성(N225 gate·마진1.2) 백테스트 →
# detail.json(+meta) 재생성 → git push (Vercel 자동 배포).
# 종료일 = 일봉 캐시 실제 마지막 거래일 + 3. NO_FETCH 로 헛수집 차단.

$ErrorActionPreference = "Continue"
$log = Join-Path $PSScriptRoot "jp_perf_weekly.log"
$qb  = "C:\quantBacktest"
$web = (Get-Item $PSScriptRoot).Parent.FullName
$env:PYTHONUTF8 = "1"
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -Append -Encoding utf8 $log }

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') jp_perf_weekly start =====" | Out-File -Append -Encoding utf8 $log

Set-Location $qb
Log "[1 yf 증분] start"
& "$qb\venv\Scripts\python.exe" "$qb\build_yf_increment.py" --market JP *>> $log
Log "[1 yf 증분] done (exit=$LASTEXITCODE)"

$lastDay = (& "$qb\venv\Scripts\python.exe" "$qb\market_calendar.py" JP-DATA 2>$null)
if (-not $lastDay) { Log "[ABORT] JP 캐시 마지막일 조회 실패"; exit 1 }
$endDate = ([DateTime]$lastDay.Trim()).AddDays(3).ToString("yyyy-MM-dd")
Log "백테스트 종료일: $endDate (캐시 마지막 $($lastDay.Trim()) + 3)"

# 채택 구성 (jp_mf_gate_e12): N225 M필터 gate + 마진1.2 · 캐시 읽기전용
$env:BT_OUTPUT_DIR = "$qb\screen"
$env:BT_MARKET = "1"
$env:BT_START_DATE = "2017-09-01"
$env:BT_END_DATE = $endDate
$env:BT_DAILY_CACHE_US = "_bt_daily_cache_jp_jq.pkl"
$env:BT_WEEKLY_CACHE_US = "_jp_weekly_cache_jq.pkl"
$env:BT_FETCH_ATTEMPTS_US = "_bt_fetch_attempts_jp_jq.pkl"
$env:BT_READONLY_CACHE = "1"
$env:BT_NO_FETCH = "1"
$env:BT_US_BUILD_RS = "1"
$env:BT_US_RS_CACHE = "jp_jq_rs.pkl"
$env:BT_ENTRY_MODE = "immediate"
$env:BT_MARKET_FILTER = "1"
$env:BT_MFILTER_MODE = "gate"
$env:BT_INDEX_TICKER = "^N225"
$env:BT_ATR_SIZING_ENABLED = "1"
$env:BT_RISK_PER_TRADE = "0.007"
$env:BT_COOLDOWN_WEEKS = "8"
$env:BT_MIN_DVOL_US = "100000000"
$env:BT_DISABLE_CA_FILTER = "1"
$env:BT_MAX_EXPOSURE = "1.2"
$env:BT_RESULT_SUFFIX = "jp_mf_gate_e12"

Log "[2 백테스트] start"
& "$qb\venv\Scripts\python.exe" "$qb\17_88_cmp_sf1.py" *>> $log
Log "[2 백테스트] done (exit=$LASTEXITCODE)"
if ($LASTEXITCODE -ne 0) { Log "[ABORT] 백테스트 실패"; exit 1 }

Log "[3 detail.json] start"
& "$qb\venv\Scripts\python.exe" "$qb\build_backtest_detail_json.py" *>> $log
Log "[3 detail.json] done (exit=$LASTEXITCODE)"

Set-Location $web
$diff = git status --porcelain app/jp-backtest/detail.json
if ($diff) {
    git add app/jp-backtest/detail.json *>> $log
    git commit -m "성과(JP) 주간 갱신: $endDate 마감 반영 (yfinance 무료 증분, 자동)" *>> $log
    git push *>> $log
    Log "[4 배포] pushed"
} else { Log "[4 배포] 변경 없음" }
"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') jp_perf_weekly done =====" | Out-File -Append -Encoding utf8 $log
