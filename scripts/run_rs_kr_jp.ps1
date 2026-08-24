# [2026-08-16 랙 수리·추가] 인코딩 정정: 파일 선두에 UTF-8 BOM 추가.
#   수리 커밋 da3abef 가 이 파일을 「BOM 없는 UTF-8 + LF 전용」으로 재저장 → Windows PowerShell 5.1 이
#   CP949 로 오독, 「가드」처럼 잔여 선두바이트로 끝나는 주석이 뒤 LF 를 삼켜 다음 줄 $skipHours = 18 이
#   주석에 흡수돼 있었다(18시간 가드 무력화 · run_kr_perf_weekly.ps1 의 BT_MARKET 삼킴과 동일 기전).
#   BOM 이 있으면 PS 5.1 이 UTF-8 로 정독한다. CRLF 시절엔 CR 이 희생돼 무사고였다.
#   되돌리기: 선두 BOM(EF BB BF) 3바이트 제거 + 이 주석 블록 삭제. 단 되돌리면 위 오독이 재발한다. 끝.
# 매주 금요일 18:00 KST — KR + JP 데이터 갱신 + 부분 Supabase 동기화.
#
# 단계:
#   1) Rebuild_weekly_cache.py     : KR _bt_daily → _kr_weekly 재구성
#   2) 14_RS_KR_pykrx.py            : KR 종목·OHLCV·RS 임계값
#   3) 15_RS_JP_screen.py           : JP 종목·OHLCV  (2 와 병렬)
#   4) export_rs_weekly --market KR --full-universe
#   5) export_rs_weekly --market JP --full-universe
#   6) add_etfs --market KR         : ETF 재적재 (export 가 universe 전체 삭제)
#   7) classify_rs96_gemini --market KR --weeks 1
#   8) classify_rs96_gemini --market JP --weeks 1
#
# 한미일 통합 분류 (classify_global_themes) 는 US 데이터 준비 후 토 07:00 잡에서.
#
# 한국 시장 마감 15:30 KST, 일본 시장 마감 15:00 KST → 16:00 이후 안전.
# 권장 시각 18:00 KST (데이터 안정화 + 사용자 활동 시간대).
#
# 18시간 가드 — 같은 일과 내 재실행 방지.

$ErrorActionPreference = "Continue"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "rs_kr_jp.log"
$qb  = "C:\quantBacktest"
$env:BT_OUTPUT_DIR = "$qb\screen"
# ★★[2026-08-24 · CAND-2026-08-24-221 · 해달별님 승인 「(가) 켠다」] RS 임계값 표 ★행 지문.
#   ★무엇을 — 표에 새 주차를 넣을 때 ★그 행이 ★어느 밑판(_kr_weekly_cache.pkl)으로 ·
#     ★어느 라이터로 계산됐는지를 `DataFrame.attrs['_row_fp']` 에 남긴다.
#   ★왜 — 이 pkl 은 ★주차별 증분 누적본이라 행마다 밑판이 다른데, 지금은 ★저장 행의
#     50.5%만 잔존 백업으로 역산되고 ★49.5%는 영구 불명이다.
#   ⚠️★★라이터가 ★둘이다 — 금 `14_RS_KR_pykrx.py`(태그 `k14` · 상폐 ★포함) ·
#     토 `17_88_cmp_sf1.py`(태그 `s17` · 상폐 ★제외). ★밑판 파일이 같아 지문 값만으로는
#     구별이 안 되므로 ★태그를 붙였다(CAND-2026-08-22-110 이중 라이터·이중 모집단).
#   ★계산 무변경 — `.values` 가 attrs 유무와 완전 동일함을 실측 확인(np.array_equal) ·
#     off재현 파일해시 일치 · pandas 2.3.3 <-> 3.0.3 교차 읽기 양방향 확인.
#   ★되돌리기 — 아래 1줄 삭제(기본 0 = 지문 안 남김 = 종전 동작).
$env:BT_RS_ROW_FP = "1"
# 절대경로 사용 — Start-Job 은 새 세션에서 시작되어 부모의 CWD 를 상속하지 않는다.
# (상대경로였을 때 JP 잡이 ~\Documents 기준으로 풀려 매번 즉시 실패했음: 2026-07-17 확인)
$silent = Join-Path $root "s2-trading-web\scripts\silent_run.py"

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

# [2026-08-16 랙 수리] 침묵 실패 관문 — KR 체인 각 단계 exit≠0 → 즉시 중단 + 텔레그램 RS 채널 알림.
#   4주간(07-25 – 08-15) Rebuild 가 매주 즉사했는데 잡은 exit 0 완주라 무감지였다
#   (근거: quant_infra/2026-08/RS_LEDGER_LAG_2026-08-16.md §0 「침묵 요인」).
#   ⚠️중단 시 병렬 JP 잡도 함께 종료된다(즉시 중단 사양 — 알림을 받으면 수동 재실행).
#   승인: 해달별님 2026-08-16 「전체 패키지」
#   되돌리기: 이 블록(변수 2개 · 함수 2개)을 삭제하고, KR 체인의 RunPyGate 호출을 구 RunPy 로 복원.
$venvPy = "C:\quantBacktest\venv\Scripts\python.exe"
$notifyPy = Join-Path $root "s2-trading-web\scripts\notify_rs_telegram.py"
function Notify($msg) {
    try { & $venvPy $notifyPy $msg *>> $log } catch { Log "[notify] FAILED: $_" }
}
function RunPyGate($label, $exe, [string[]]$pyArgs) {
    Log "[$label] start  ($exe $($pyArgs -join ' '))"
    try {
        & $exe @pyArgs *>> $log
    } catch {
        Log "[$label] FAILED: $_"
        Notify "[rs_kr_jp] $label 단계 예외 — 잡 중단. 로그: rs_kr_jp.log"
        exit 1
    }
    Log "[$label] done (exit=$LASTEXITCODE)"
    if ($LASTEXITCODE -ne 0) {
        Log "[ABORT] $label exit=$LASTEXITCODE — 중단 + 텔레그램 알림"
        Notify "[rs_kr_jp] $label 단계 실패(exit=$LASTEXITCODE) — 잡 중단. 로그: rs_kr_jp.log"
        exit 1
    }
}
# [2026-08-16 랙 수리] 끝

function StartPyJob($label, [string[]]$pyArgs, $jobLog) {
    Log "[$label] start (job)  ($($pyArgs -join ' ')) → $jobLog"
    # $wd 를 명시 전달 후 Set-Location — Start-Job 은 CWD 를 상속하지 않으므로
    # 스크립트 내부의 상대경로(캐시·설정 파일 등)도 부모와 동일하게 풀리도록 맞춘다.
    Start-Job -Name $label -ScriptBlock {
        param($args2, $jobLog2, $wd)
        Set-Location $wd
        $env:BT_OUTPUT_DIR = "C:\quantBacktest\screen"
        try { & C:\Python314\python.exe @args2 *>> $jobLog2 } catch { "FAILED: $_" | Out-File -Append -Encoding utf8 $jobLog2 }
    } -ArgumentList (,$pyArgs), $jobLog, $root
}

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') rs_kr_jp start =====" | Out-File -Append -Encoding utf8 $log

# 18시간 가드
$skipHours = 18
if (Test-Path $log) {
    $lastDone = (Get-Content $log -ErrorAction SilentlyContinue) | Select-String -Pattern "rs_kr_jp done" -SimpleMatch | Select-Object -Last 1
    if ($lastDone) {
        $tsText = $lastDone.Line.Substring(0, 19)
        try {
            $lastTs = [DateTime]::ParseExact($tsText, "yyyy-MM-dd HH:mm:ss", $null)
            $age = (Get-Date) - $lastTs
            if ($age.TotalHours -lt $skipHours) {
                Log "[SKIP] 마지막 실행 $($lastTs) ($([int]$age.TotalHours)h 전) → 건너뜀"
                "===== rs_kr_jp skipped =====" | Out-File -Append -Encoding utf8 $log
                exit 0
            }
        } catch { }
    }
}

# JP 스크리닝 (15_RS_JP) 은 KR 과 독립 — 1 단계와 병렬 시작.
$logJP = Join-Path $PSScriptRoot "rs_kr_jp_jp.log"
# ── JP 체인 전체를 하나의 잡으로 (스크리닝 → export → 분류) ────────────
# JP 는 KR 과 데이터·스크리닝·적재가 완전히 독립이다. Supabase 삭제도 market 단위로
# 격리되어(`?market=eq.KR` / `?market=eq.JP`) KR export 와 행이 겹치지 않으므로
# 안전하게 병렬 실행 가능. (이전 구조는 JP export 가 KR 완료를 기다려, KR 이 지연·실패하면
#  JP 웹 갱신까지 함께 막혔음 — 2026-07-17 수정)
$jobJP = Start-Job -Name "JP chain" -ScriptBlock {
    param($wd, $silent2, $qb2, $jobLog2, $gmodel)
    Set-Location $wd
    $env:BT_OUTPUT_DIR = "$qb2\screen"
    $env:GEMINI_MODEL  = $gmodel
    function J($label, [string[]]$a) {
        "$(Get-Date -Format 'HH:mm:ss')  [$label] start" | Out-File -Append -Encoding utf8 $jobLog2
        try { & C:\Python314\python.exe @a *>> $jobLog2 } catch { "[$label] FAILED: $_" | Out-File -Append -Encoding utf8 $jobLog2 }
        "$(Get-Date -Format 'HH:mm:ss')  [$label] done (exit=$LASTEXITCODE)" | Out-File -Append -Encoding utf8 $jobLog2
    }
    J "3 15_RS_JP"   @($silent2, "$qb2\15_RS_JP_screen.py")
    J "5 export JP"  @("s2-trading-web\scripts\export_rs_weekly.py", "--market", "JP", "--weeks", "56", "--full-universe")
    J "8 classify JP" @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "JP", "--weeks", "1")
} -ArgumentList $root, $silent, $qb, $logJP, "gemini-2.5-pro"
Log "[JP chain] start (job) → $logJP  (KR 과 병렬)"

# ── KR 체인 (메인 스레드) — append → rebuild → RS → export → ETF → 분류 ──────────
# [2026-08-16 랙 수리] 세 가지를 바꿨다 (근거: quant_infra/2026-08/RS_LEDGER_LAG_2026-08-16.md):
#   ① 단계 [0] 신설 — KR 일봉 live 캐시(_bt_daily_cache_kr_live.pkl) 주간 연장.
#      원본 _bt_daily_cache_kr.pkl 은 읽기 전용 유지(CLAUDE.md 0-3) — 어펜더가 live 만 append.
#      (임무 원안의 _ext.pkl 이름은 2026-07-06 「2008 확장」 산출물이 이미 점유 → live 로 명명)
#   ② [1 Rebuild] 실행자 C:\Python314(pandas 2.3.3) → venv(pandas 3.0.3) 교체 —
#      07-24 재저장이 pandas3 StringDtype 피클이라 Python314 는 4주 연속 NotImplementedError 즉사.
#      BT_DAILY_CACHE_KR env 로 live 캐시를 지정(Rebuild_weekly_cache.py 가 env 지원 · 기본값 원본).
#   ③ 전 단계 RunPyGate 관문화 — exit≠0 → 즉시 중단 + 텔레그램 RS 알림 (침묵 실패 차단).
#   승인: 해달별님 2026-08-16 「전체 패키지」
#   되돌리기: 아래 신설 블록(RunPyGate 호출부)을 지우고 다음 구 호출 5줄의 주석을 해제.
# RunPy "1 Rebuild"    @("$qb\Rebuild_weekly_cache.py")
# RunPy "2 14_RS_KR"   @($silent, "$qb\14_RS_KR_pykrx.py")
# RunPy "4 export KR"  @("s2-trading-web\scripts\export_rs_weekly.py", "--market", "KR", "--weeks", "56", "--full-universe")
# RunPy "6 add KR ETFs" @("s2-trading-web\scripts\add_etfs.py", "--market", "KR", "--weeks", "56")
# RunPy "7 classify KR" @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "KR", "--weeks", "1")
RunPyGate "0 append KR daily" $venvPy @("$qb\screen\append_kr_daily_cache.py")
$env:BT_DAILY_CACHE_KR = "_bt_daily_cache_kr_live.pkl"   # Rebuild 일봉 입력을 live 로 (기본값=원본)
RunPyGate "1 Rebuild"    $venvPy @("$qb\Rebuild_weekly_cache.py")
Remove-Item Env:BT_DAILY_CACHE_KR -ErrorAction SilentlyContinue   # 국소 적용 — 후속 단계 오염 방지
RunPyGate "2 14_RS_KR"   "C:\Python314\python.exe" @($silent, "$qb\14_RS_KR_pykrx.py")
RunPyGate "4 export KR"  "C:\Python314\python.exe" @("s2-trading-web\scripts\export_rs_weekly.py", "--market", "KR", "--weeks", "56", "--full-universe")
# export 가 (해당 마켓의) universe 전체 삭제 후 재적재 → KR ETF 재적재 필요 (JP 는 ETF 화이트리스트 없음)
RunPyGate "6 add KR ETFs" "C:\Python314\python.exe" @("s2-trading-web\scripts\add_etfs.py", "--market", "KR", "--weeks", "56")
$env:GEMINI_MODEL = "gemini-2.5-pro"
RunPyGate "7 classify KR" "C:\Python314\python.exe" @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "KR", "--weeks", "1")
# [2026-08-16 랙 수리] 끝

# ── JP 잡 합류 (KR 이 먼저 끝나면 여기서 대기) ─────────────────────────
Log "[wait] JP 체인 대기..."
Wait-Job -Job $jobJP | Out-Null
Log "[JP chain] done (job state=$($jobJP.State))"
Remove-Job -Job $jobJP
# [2026-08-16 랙 수리] JP 체인 침묵 실패 스캔 — 병렬 잡이라 메인 관문(RunPyGate)이 못 본다.
#   JP 로그에서 done(exit≠0) 또는 FAILED 를 찾으면 텔레그램 알림 + exit 1.
#   되돌리기: $jpFail 관련 4줄과 마지막 if 블록을 삭제(구 동작 = 로그 병합만).
$jpFail = $false
if (Test-Path $logJP) {
    "--- $logJP ---" | Out-File -Append -Encoding utf8 $log
    Get-Content $logJP -Encoding utf8 | Out-File -Append -Encoding utf8 $log
    $jpLines = Get-Content $logJP -Encoding utf8
    $jpBad = $jpLines | Select-String -Pattern 'done \(exit=(-?\d+)\)' | Where-Object { $_.Matches[0].Groups[1].Value -ne '0' }
    if ($jpBad -or ($jpLines | Select-String -SimpleMatch 'FAILED:')) { $jpFail = $true }
    Remove-Item $logJP -Force -ErrorAction SilentlyContinue
}
if ($jpFail) {
    Log "[JP chain] 단계 실패 감지 — 텔레그램 알림 + exit 1 (KR 체인은 이미 완주)"
    Notify "[rs_kr_jp] JP 체인 단계 실패 감지 — 로그: rs_kr_jp.log"
    Log "===== rs_kr_jp done (JP FAIL) ====="
    exit 1
}
# [2026-08-16 랙 수리] 끝

Log "===== rs_kr_jp done ====="
