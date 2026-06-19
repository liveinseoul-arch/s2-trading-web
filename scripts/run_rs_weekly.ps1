# 매주 토요일 02:00 — RS 캐시·테이블·Supabase 풀세트 갱신.
#
# 병렬 단계 (의존성 분석):
#   1) Rebuild_weekly_cache.py  : KR _bt_daily → _kr_weekly 재구성 + 자동 백업
#   2) 14_RS_KR_pykrx.py         : KR 종목·주간 OHLCV·RS 임계값 테이블 신선화 (1 필요)
#   3) 13_RS_US_screen.py        : US 종목·주간 OHLCV·RS 임계값 테이블 신선화 (독립)
#   4) 15_RS_JP_screen.py        : JP 종목·주간 OHLCV 신선화 (독립)
#   5) export_rs_weekly.py       : 마감지기 Supabase rs_top_weekly/rs_history_weekly 동기화 (2+3+4 모두 필요)
#   6) classify_rs96_gemini.py   : Gemini 분류 (5 필요)
#
# 병렬 패턴: 1·3·4 동시 → 1 끝나면 2 시작 → 2·3·4 모두 끝나면 5 → 6
# 순차 ~154분 → 병렬 ~74분 (50% 단축).
#
# 13_/14_/15_ 는 input() 사용. PS 5.1 stdin pipe 가 BOM 을 prepend 해 깨지는 문제 회피 위해
# silent_run.py wrapper 가 builtins.input 을 monkey-patch 한 뒤 모듈 import + main() 호출.
$ErrorActionPreference = "Continue"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "rs_weekly.log"
$qb  = "C:\quantBacktest"
$env:BT_OUTPUT_DIR = "$qb\screen"
$silent = "s2-trading-web\scripts\silent_run.py"

function Log($m) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -Append -Encoding utf8 $log
}

# Foreground Python runner — 단계별 로그 기록.
function RunPy($label, [string[]]$pyArgs) {
    Log "[$label] start  ($($pyArgs -join ' '))"
    try {
        & C:\Python314\python.exe @pyArgs *>> $log
        Log "[$label] done (exit=$LASTEXITCODE)"
    } catch {
        Log "[$label] FAILED: $_"
    }
}

# Background Python launcher — 별도 log 파일에 기록 후 PSJob 반환.
function StartPyJob($label, [string[]]$pyArgs, $jobLog) {
    Log "[$label] start (job)  ($($pyArgs -join ' ')) → $jobLog"
    Start-Job -Name $label -ScriptBlock {
        param($args2, $jobLog2)
        try {
            & C:\Python314\python.exe @args2 *>> $jobLog2
        } catch {
            "FAILED: $_" | Out-File -Append -Encoding utf8 $jobLog2
        }
    } -ArgumentList (,$pyArgs), $jobLog
}

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') rs_weekly start =====" | Out-File -Append -Encoding utf8 $log

# ── 중복 실행 가드 — 마지막 done 마커가 18시간 이내면 skip
$skipHours = 18
if (Test-Path $log) {
    $lastDone = (Get-Content $log -ErrorAction SilentlyContinue) `
                | Select-String -Pattern "rs_weekly done" -SimpleMatch `
                | Select-Object -Last 1
    if ($lastDone) {
        $tsText = $lastDone.Line.Substring(0, 19)
        try {
            $lastTs = [DateTime]::ParseExact($tsText, "yyyy-MM-dd HH:mm:ss", $null)
            $age = (Get-Date) - $lastTs
            if ($age.TotalHours -lt $skipHours) {
                Log "[SKIP] 마지막 실행 $($lastTs) ($([int]$age.TotalHours)h $($age.Minutes)m 전) < ${skipHours}h → 건너뜀"
                "===== rs_weekly skipped =====" | Out-File -Append -Encoding utf8 $log
                exit 0
            }
        } catch { }
    }
}

# ── 병렬 단계 1·3·4 ──────────────────────────────
$logUS = Join-Path $PSScriptRoot "rs_weekly_us.log"
$logJP = Join-Path $PSScriptRoot "rs_weekly_jp.log"
$jobUS = StartPyJob "3/6 13_RS_US" @($silent, "$qb\13_RS_US_screen.py") $logUS
$jobJP = StartPyJob "4/6 15_RS_JP" @($silent, "$qb\15_RS_JP_screen.py") $logJP

# 1단계 (KR rebuild) 는 foreground — 빠르고 (~30s) 2단계 진입 위해 직접 대기.
RunPy "1/6 Rebuild"   @("$qb\Rebuild_weekly_cache.py")

# 2단계 — 1단계 완료 직후 시작. US/JP 잡과 병렬 진행.
RunPy "2/6 14_RS_KR"  @($silent, "$qb\14_RS_KR_pykrx.py")

# US/JP 잡 완료 대기 + 결과 로그를 본 log 에 append.
Log "[wait] US/JP 잡 완료 대기..."
Wait-Job -Job $jobUS, $jobJP | Out-Null
foreach ($job in @($jobUS, $jobJP)) {
    $jobName = $job.Name
    $exit = if ($job.State -eq "Completed") { 0 } else { 1 }
    Log "[$jobName] done (job state=$($job.State))"
    Remove-Job -Job $job
}
# 잡 로그 본 log 에 append (참조용)
foreach ($jl in @($logUS, $logJP)) {
    if (Test-Path $jl) {
        "--- $jl ---" | Out-File -Append -Encoding utf8 $log
        Get-Content $jl -Encoding utf8 | Out-File -Append -Encoding utf8 $log
        Remove-Item $jl -Force -ErrorAction SilentlyContinue
    }
}

# ── 순차 단계 5·6 ──────────────────────────────
RunPy "5/6 export"    @("s2-trading-web\scripts\export_rs_weekly.py")
$env:GEMINI_MODEL = "gemini-2.5-pro"
RunPy "6/6 classify"  @("s2-trading-web\scripts\classify_rs96_gemini.py", "--weeks", "1")

Log "===== rs_weekly done ====="
