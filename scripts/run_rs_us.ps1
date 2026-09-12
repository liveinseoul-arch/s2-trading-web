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

# [CAND-2026-09-12-7] 단계 실패를 삼키던 것을 없앤다 - 2026-09-12.
#   종전 RunPy 는 단계가 exit!=0 이어도 로그만 남기고 다음 단계로 넘어갔고,
#   스크립트가 끝까지 가서 스케줄러는 S2_rs_us rc=0 으로 받았다.
#   실측 - 2026-09-12 07:44-07:50 Gemini 429(월 지출 캡 초과)로 4단계(classify US)와
#   5단계(classify global)가 둘 다 exit=1 인데 잡은 rc=0. 한미일 테마 09-11 주차가
#   통째로 비었고(US 0종목 . 통합 요약 없음) 해달별님이 화면을 보고 발견하셨다.
#   ★그리고 rc=0 이라 CAND-2026-09-12-6 의 재시도(3회/10분)가 원리적으로 발동하지 않는다.
#   선행 - CAND-2026-08-24-306 이 단서 칸에 "run_rs_us.ps1:52 도 같은 부류"라 적었는데
#   수리 범위에서 빠졌다(run_rs_signal.ps1 만 고쳤다 . 08-25 8baa578).
#   ★처치는 run_rs_kr_jp.ps1:116-132 에 이미 있는 기계를 그대로 옮긴 것이다.
#   ★되돌리기 - RS_US_STRICT=0 한 줄이면 종전 동작(계속 진행 . 알림 없음 . rc=0).
#     기본 on 인 이유 - 기본 off 면 다음 주 토요일에 같은 실패가 또 조용히 지나간다.
$strictUS = ($env:RS_US_STRICT -ne "0")
$notifyPy = Join-Path $root "s2-trading-web\scripts
otify_rs_telegram.py"
function Notify($msg) {
    try { & C:\Python314\python.exe $notifyPy $msg *>> $log } catch { Log "[notify] FAILED: $_" }
}

function RunPy($label, [string[]]$pyArgs) {
    Log "[$label] start  ($($pyArgs -join ' '))"
    try {
        & C:\Python314\python.exe @pyArgs *>> $log
    } catch {
        Log "[$label] FAILED: $_"
        if ($strictUS) {
            Notify "[rs_us] $label 단계 예외 - 잡 중단. 로그: rs_us.log"
            Log "===== rs_us aborted ====="
            exit 1
        }
        return
    }
    Log "[$label] done (exit=$LASTEXITCODE)"
    if ($LASTEXITCODE -ne 0 -and $strictUS) {
        Log "[ABORT] $label exit=$LASTEXITCODE - 중단 + 텔레그램 알림"
        Notify "[rs_us] $label 단계 실패(exit=$LASTEXITCODE) - 잡 중단. 로그: rs_us.log"
        Log "===== rs_us aborted ====="
        exit 1
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

$env:GEMINI_MODEL = "gemini-2.5-flash"
RunPy "4 classify US" @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "US", "--weeks", "1")
RunPy "5 classify global" @("s2-trading-web\scripts\classify_global_themes.py", "--weeks", "1")
RunPy "6 subdivide"   @("s2-trading-web\scripts\subdivide_global_themes.py", "--weeks", "1", "--min", "50")

Log "===== rs_us done ====="
exit 0
