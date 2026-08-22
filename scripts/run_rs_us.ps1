# 매주 토요일 07:00 KST — US 데이터 갱신 + 한미일 통합 분류.
#
# 미국 시장 마감 (DST 토 05:00 KST / EST 토 06:00 KST) 이후 안정화 buffer.
# 권장 07:00 KST.
#
# 단계:
#   1) 13_RS_US_screen.py             : US 종목·OHLCV·RS 임계값
#   2) export_rs_weekly --market US --full-universe
#   3) add_etfs --market US           : US ETF 재적재
#   4) classify_rs96_gemini --market US --weeks 1   (per-market 테마)
#   5) classify_global_themes --weeks 1             (한미일 통합)
#   6) subdivide_global_themes --weeks 1 --min 50   (50+ 테마 세분화)
#
# 18시간 가드 — 같은 일과 내 재실행 방지.

$ErrorActionPreference = "Continue"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName
Set-Location $root
$log = Join-Path $PSScriptRoot "rs_us.log"
$qb  = "C:\quantBacktest"
$env:BT_OUTPUT_DIR = "$qb\screen"
$silent = "s2-trading-web\scripts\silent_run.py"

function Log($m) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -Append -Encoding utf8 $log
}

function RunPy($label, [string[]]$pyArgs) {
    Log "[$label] start  ($($pyArgs -join ' '))"
    try {
        & C:\Python314\python.exe @pyArgs *>> $log
        Log "[$label] done (exit=$LASTEXITCODE)"
    } catch {
        Log "[$label] FAILED: $_"
    }
}

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') rs_us start =====" | Out-File -Append -Encoding utf8 $log

# 18시간 가드
$skipHours = 18
if (Test-Path $log) {
    $lastDone = (Get-Content $log -ErrorAction SilentlyContinue) | Select-String -Pattern "rs_us done" -SimpleMatch | Select-Object -Last 1
    if ($lastDone) {
        $tsText = $lastDone.Line.Substring(0, 19)
        try {
            $lastTs = [DateTime]::ParseExact($tsText, "yyyy-MM-dd HH:mm:ss", $null)
            $age = (Get-Date) - $lastTs
            if ($age.TotalHours -lt $skipHours) {
                Log "[SKIP] 마지막 실행 $($lastTs) ($([int]$age.TotalHours)h 전) → 건너뜀"
                "===== rs_us skipped =====" | Out-File -Append -Encoding utf8 $log
                exit 0
            }
        } catch { }
    }
}

RunPy "1 13_RS_US"    @($silent, "$qb\13_RS_US_screen.py")
RunPy "2 export US"   @("s2-trading-web\scripts\export_rs_weekly.py", "--market", "US", "--weeks", "56", "--full-universe")
RunPy "3 add US ETFs" @("s2-trading-web\scripts\add_etfs.py", "--market", "US", "--weeks", "56")

$env:GEMINI_MODEL = "gemini-2.5-pro"
RunPy "4 classify US" @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "US", "--weeks", "1")
RunPy "5 classify global" @("s2-trading-web\scripts\classify_global_themes.py", "--weeks", "1")
RunPy "6 subdivide"   @("s2-trading-web\scripts\subdivide_global_themes.py", "--weeks", "1", "--min", "50")

Log "===== rs_us done ====="
