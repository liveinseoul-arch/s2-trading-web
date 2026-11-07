# 매주 토요일 07:00 KST — US 데이터 갱신 + 한미일 통합 분류.
#
# 미국 시장 마감 (DST 토 05:00 KST / EST 토 06:00 KST) 이후 안정화 buffer.
# 권장 07:00 KST.
#
# 단계:
#   1) 13_RS_US_screen.py             : US 종목·OHLCV·RS 임계값
#   2) export_rs_weekly --market US --full-universe
#   3) add_etfs --market US           : US ETF 재적재
#   4) classify_rs96_gemini --market US --weeks N --refill   (per-market 테마 · 최신 N주차 중 미분류만)
#   5) classify_global_themes --refill                        (한미일 통합 · 최신 N주차 안의 불합격만)
#   6) subdivide_global_themes --weeks N --refill --min 50   (50+ 테마 세분화 · 최신 N주차 중 미세분화만)
#   ★[2026-11-06 · B7] ★4–6 은 RS_US_CLASSIFY_REFILL="1" 일 때 위와 같고 "0" 이면 종전 `--weeks 1`(아래 분기).
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
# ★[2026-11-06 · CAND-2026-11-04-10 · 해달별님 「권고대로」] ★종전 두 줄은 ★리터럴 개행(`\n` 붕괴)이라
#   ★경로가 `scripts\r\notify…` 가 되어 ★중단 알림이 ★한 번도 안 나갔다([Errno 22]). ★한 줄로 고친다.
$notifyPy = Join-Path $root "s2-trading-web\scripts\notify_rs_telegram.py"
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
# ★★★[2026-10-20 채택 · CAND-2026-10-20-29] ★RS 주간 3표 적재를 ★스테이징 swap 으로.
#   ⚠️★US 가 ★가장 크다 — ★단일 RPC 본문 어림 ★28.73 MB 로 ★모체(`S2_RS_RPC`)가
#     ★타임아웃하는 구간이다(실측 20.51MB 가 ★이미 실패). ★이 경로는 ★본문이 ★84 bytes 다.
#   ★선결 — ★마이그레이션 `supabase/migrations/2026-10-20_rs_weekly_swap.sql` ★적용 완료.
#   ★되돌리기 — ★이 줄을 ★지우면 ★종전 경로다(기본값 0).
$env:S2_RS_SWAP = "1"
# ★★[2026-10-24 · CAND-2026-09-30-2 처치③ · 해달별님 2026-10-23 승인] ★시총 결측 탈락을 ★로그에 낸다(★적재 무변경).
$env:RS_LOG_MCAP_GAP = "1"
# ★★★[2026-10-24 채택 · CAND-2026-10-24-36 · ★★해달별님 결정] ★KR 야후 접미사 중복 수리 — ★KR 일봉 EMA 폴백이 ★한 번도 성공한 적이 없었다(`000400.KS.KS` 꼴 · ★라이브 6요청 ★현행 0/6 → ★수리 3/3).
#   ⚠️★미실시 — 종결조건 ②의 ★원문 방법(`--dry-run` 1런)은 ★안 돌렸다 ⇒ ★★「그 런에서 404 가 0 이 안 되면 ★이 close 는 무효」가 ★재개방 조건이다.
#   ★되돌리기 — ★이 줄(과 다른 2자리)을 지우면 ★기본 "0" = 종전.
$env:RS_YF_SUFFIX_FIX = "1"
RunPy "2 export US"   @("s2-trading-web\scripts\export_rs_weekly.py", "--market", "US", "--weeks", "56", "--full-universe")
# ★★[2026-11-08 · CAND-2026-10-23-25 · ★해달별님 승인] ★ETF 재적재 (시장, 종목) 범위 swap(스테이징 + `rs_universe_ticker_swap` RPC 1회 · 이식 = CAND-2026-10-20-8).
#   ★선결 — `2026-10-23_rs_universe_ticker_swap.sql` 적용(2026-11-08). ★함수가 없으면 add_etfs 가 멈추고 본표는 종전 그대로다. ★되돌리기 = ★이 줄을 지운다(기본 "0").
$env:S2_ETF_SWAP = "1"
RunPy "3 add US ETFs" @("s2-trading-web\scripts\add_etfs.py", "--market", "US", "--weeks", "56")

# ★★[2026-09-18 · 해달별님 지시] ★flash 고정 → ★pro 로 되돌렸다.
#   ★근거 — ★월 지출 캡이 ₩4,000 → ★₩24,000 으로 6배 올랐다(2026-09-12 19:15),
#     ★실측 2026-09-18 — ★₩6,132 사용 · ★pro 프로브 HTTP 200.
#   ⚠️★★[2026-09-18 정정 · 해달별님 지적] ★캡을 낮춰
#     ★「₩20,000 초과면 flash」를 구현하려던 ★B 안은 ★틀렸다 — ★철회.
#   ★근거 — ★지출 캡 429 는 ★모델별이 아니라 ★★프로젝트 단위다:
#     'Your project has exceeded its monthly spending cap.'  (2026-09-12 실측 로그)
#     ★즉 캡에 닿으면 ★flash 도 ★똑같이 막힌다 — ★캡을 낮추면
#     ★더 빨리 ★탈출구 없이 죽는다.
#   ⚠️★★따라서 ★아래 FALLBACK 은 ★지출 캡에는 ★도움이 되지 않는다 —
#     ★모델별 한도(RPM·TPM) 429 에만 유효하다. ★그만큼은 이득이라 ★남겨 둔다.
#   ★「₩20,000 초과면 flash」는 ★하드 캡 ★전에 전환해야 하므로
#     ★월 소진액을 ★아는 장치가 필요하다 — ★미구현(결정 대기).
#   ★★안전망 — `classify_rs96_gemini.py` 가 ★429 RESOURCE_EXHAUSTED 에서
#     ★대기 없이 ★flash 로 내려간다(`FALLBACK_MODEL`). ★즉 캡을 때려도 ★죽지 않는다.
#   ★되돌리기 — 이 리터럴을 "gemini-2.5-flash" 로. ★또는 $env:GEMINI_MODEL 한 줄.
$env:GEMINI_MODEL = "gemini-2.5-pro"
# ★★[2026-11-06 · CAND-2026-09-27-7 처치 ② · 해달별님 결재 B7 「권고대로」] ★분류 3단계(4·5·6)를 `--refill` 계열로.
#   ★무엇 — 종전 `--weeks 1` 은 ★최신 주차만 보므로 ★한 번 빠진 주차는 ★영구 공백이 됐다.
#     ★실발생 2건 — 10-09(4단계 WinError 10054 ABORT) · 10-30(2단계 swap 57014 ABORT) ⇒ 둘 다 「분류행 없음」(11-06 --audit).
#   ★--refill 의 뜻(단계별) — 4: 최신 N주차 중 rs_theme_weekly(US) 행이 없는 주차만 ·
#     5: --audit 불합격 주차 중 최신 N주차 안의 것만(RS_THEME_REFILL_RECENT=N) · 6: 최신 N주차 중 rs_subtheme_global_weekly 행이 없는 주차만.
#   ★Gemini 상한 — 공백 0 이면 종전과 동일(4: 1회 · 5: 1회+보충≤2 · 6: 50+ 테마 수). 공백 k주차면 ★+k(4) · +k(+보충≤2k)(5) · +k×(50+ 테마 수)(6).
#     ★N 이 상한이라 ★2026-02 – 05 의 「누락 10 – 15%」 9주차(11-06 --audit 실측)는 ★건드리지 않는다(맨 --refill 이면 11주차 전부 재분류).
#   ⚠️★RS_THEME_MKT_GATE(처치 ①)와의 충돌 해법 — 5단계 refill 에서 ★게이트는 ★최신 주차에만 hard(잡 중단 + 알림)이고
#     ★옛 주차는 soft(그 주차만 건너뛰고 계속). ★옛 주차의 완전성 관문 실패도 ★잡을 세우지 않는다(stdout 경고 · check_docs 검사 29 가 잡는다).
#   ★되돌리기 — 아래 줄을 "0"(또는 삭제) = 종전 `--weeks 1` 세 줄과 ★인자 배열 동일(검증 → OPS_FIX_B7_RS_US_REFILL_2026-11-06.md).
$env:RS_US_CLASSIFY_REFILL = "1"
if (-not $env:RS_US_REFILL_RECENT) { $env:RS_US_REFILL_RECENT = "6" }
# --- B7 args begin (검증 스크립트가 이 구간을 그대로 평가한다 · 마커를 지우지 말 것)
if ($env:RS_US_CLASSIFY_REFILL -eq "1") {
    $refillN = $env:RS_US_REFILL_RECENT
    $env:RS_THEME_REFILL_RECENT = $refillN
    $args4 = @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "US", "--weeks", $refillN, "--refill")
    $args5 = @("s2-trading-web\scripts\classify_global_themes.py", "--refill")
    $args6 = @("s2-trading-web\scripts\subdivide_global_themes.py", "--weeks", $refillN, "--refill", "--min", "50")
} else {
    $args4 = @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "US", "--weeks", "1")
    $args5 = @("s2-trading-web\scripts\classify_global_themes.py", "--weeks", "1")
    $args6 = @("s2-trading-web\scripts\subdivide_global_themes.py", "--weeks", "1", "--min", "50")
}
# --- B7 args end
RunPy "4 classify US" $args4
# ★★[2026-10-25 신설 · CAND-2026-09-27-7 처치 ①] ★3국 사전 게이트 — 0종목 시장이면 중단.
#   ★무엇 — classify_global_themes.py 가 Gemini 를 부르기 ★전에 KR·US·JP 행수를 보고
#     ★한 시장이라도 0행이면 ★exit=1 로 멈춘다(위 RunPy 가 알림 + 잡 중단).
#   ★실발생 — 2026-09-25 주차 KR 0/51 · US 37/37 · JP 0/62 가 ★그대로 적재됐고 ★exit=0 이었다.
#     ⚠️하류 완전성 관문은 ★원리적으로 못 잡는다 — 판정식이 b > 0 and a == 0 이라
#     ★분모 b 가 0 인 시장은 세지 않는다. check_docs 검사 29 도 같은 식이라 ★탐지로는 못 메운다.
#   ★왜 런처에서만 켜나 — 스케줄 경로는 --weeks 1(최신 주차)이라 세 시장이 다 있어야 정상이다.
#     수동 백필(--refill)은 옛 주차를 훑어 JP·US 0행이 ★정상이므로 코드 기본값은 off 로 둔다.
#   ★[2026-11-06 · B7] ★런처가 --refill 로 바뀌어도 ★이 게이트는 ★최신 주차에만 hard 다 —
#     ★옛 주차는 RS_THEME_REFILL_RECENT>0 이면 soft(건너뜀) 라 ★위 「오탐」이 ★잡을 세우지 않는다.
#   ★되돌리기 — ★이 줄을 지운다(또는 "0"). ★기본 "0" = 종전 비트동일(합성 대조 4/4 stdout 동일).
$env:RS_THEME_MKT_GATE = "1"
RunPy "5 classify global" $args5
RunPy "6 subdivide"   $args6

Log "===== rs_us done ====="
exit 0
