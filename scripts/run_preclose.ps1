# 15:10 장마감 전 — 라이브 스냅샷으로 동시호가 신규 매수 후보 산출 → Supabase + 텔레그램
$ErrorActionPreference = "Stop"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # scripts → s2-trading-web → s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "preclose.log"
"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') preclose =====" | Out-File -Append -Encoding utf8 $log

# ★★★[2026-10-22 채택 · CAND-2026-10-22-21] 15:10 알람도 ★같은 지지선을 쓰게 한다.
#   ⚠️★★이 런처는 ★종전까지 env 를 ★하나도 설정하지 않았다 — ★그래서 ★이 한 줄을 ★빠뜨리면
#     ★15:10 에 안내한 지정가와 ★20:30 export_eod 의 주문계획이 ★서로 다른 값이 된다
#     (★CAND-2026-10-20-35 와 ★같은 계열의 사고. ★HANDOFF 2026-10-22 v2 §0-0 2번이 경고한 바로 그것).
#   ★경로 — export_preclose.py:76-77 → s2_candidates.reconstruct / .extract (둘 다 이식 완료).
#   ★되돌리기 — ★이 한 줄 삭제(기본 0 = off = 종전 동일 · 출력 전문 대조로 확인).
#   → quant_infra/2026-10/S2_NEWLIST_STAGE_ENTRY_GRID_2026-10-22.md §10
# ★★★[2026-10-24 ★해달별님 지적 「하나만 작용시켜야 되는 거 아닐까」] ★A 를 끔다.
#   ★★아래 `S2_NEWLIST_TV_SKIP` 과 ★배타다 — ★B 가 첫날 거래대금을 ★0 으로 만들면
#     ★A 의 판정(「자격봉이 상장 첫날인가」)이 ★영구히 거짓이 된다.
#     ★실측 2026-10-24 — B on 에서 `[NEWLIST21] 자격 0 · 진입 지연 0 · 1회적용 0`
#     (B off 일 때는 자격 4,332 · 지연 3,204 · 41종목) · 2026-10-23 2x2 ★⑤셀 = ★④셀 동일.
#   ★★되돌리기 — ⚠️★아래 `S2_NEWLIST_TV_SKIP` 을 끄면 ★이 줄을 ★"0.05" 로 함께 되돌린다.
#     ★그래야 2026-10-22 채택 상태(A 단독)로 돌아간다. ★줄을 지우지 않는 이유가 ★이것이다.
#   → quant_infra/2026-10/S2_NEWLIST_STAGE_ENTRY_GRID_2026-10-22.md §10(원 채택 근거)
$env:S2_NEWLIST_ENTRY_DROP = "0"                                       # ★B 와 배타 — 끔다(종전 0.05)

# ★★★[2026-10-24 채택 · ★해달별님 결정 · CAND-2026-10-22-18] ★신규상장 ★초기 2거래일 거래대금을 ★진입 자격에서 제외.
#   ★★왜 — ★상장 첫날 거래대금은 ★대부분 공모주 유통 물량이고 ★그날 하루뿐이라
#     ★「5,000억 = 이 종목은 충분히 유동적」이라는 ★전제가 ★그 봉에서는 ★거짓이다.
#     ★실측(2026-10-24 · 네오사피엔스 0161M0) — ★상장일 13,259.9억이 ★유일한 5,000억 봉이고
#     ★그 뒤로는 ★최대 953.7억 ⇒ ★그 한 봉이 ★진입 신호를 ★통째로 만들었다.
#   ★성과 아니라 ★무결성 축이다 — ⚠️★가격표는 ★지불한다: ★결정창 CAGR ★17.55 → ★16.34(★−★★1.21%p)
#     · ★MDD ★−6.5022 → ★−6.5011(★사실상 불변) · ★제외 5,000억 초과봉 ★212건 · ★체결 4,518 → 3,978.
#   ⚠️★★`S2_NEWLIST_ENTRY_DROP`(위) 과 ★배타다 — ★이걸 켜면 ★그쪽 자격 판정이 ★영구히 거짓이 돼
#     ★발동이 ★0 이 된다(★실측 `[NEWLIST21] 자격 0 · 진입 지연 0`). ★남겨두어도 ★무해하고
#     ★아래 두 줄을 지우면 ★그쪽이 ★다시 산다(2026-10-23 2x2 ★⑤셀 = ★④셀 로 확인됨).
#   ★되돌리기 — ★아래 `S2_NEWLIST_TV_SKIP` 한 줄을 "0" 으로(기본 off = 종전 비트동일).
#   → quant_infra/2026-10/S2_NEWLIST_2X2_2026-10-23.md §④ · prereg/2026-10-22_S2_신규상장_첫날_거래대금_제외.md
$env:S2_NEWLIST_TV_SKIP      = "1"                                     # ★신규상장 초기 거래대금을 자격에서 제외(기본 off)
$env:S2_NEWLIST_TV_SKIP_DAYS = "7"                                     # ★「초기 7거래일」 — ★★해달별님 지시 2026-10-28(종전 2 · 되돌리기 "2")

# ★★★[2026-10-24 채택 · 해달별님 결정 · CAND-2026-10-24-21] ★사이징·레버·추가매수 3축도 맞춘다.
#   ★★무엇이 틀렸나 — 위 `S2_NEWLIST_ENTRY_DROP` 은 ★지지선만 맞컰고,
#     ★★「포트 몇 %를 사라」는 ★여전히 어긋나 있었다. ★실측(2026-10-24 · 0런 코드 대조):
#       ★SIZE_BELOW  알람 0.075   대 운영 0.054167  = ★★**1.385배**  (s2_candidates.py:32 대 run_eod.ps1:249)
#       ★MAX_LEV     알람 1.3     대 운영 1.0                   (s2_candidates.py:94 대 run_eod.ps1:262)
#       ★ADD_DROP    알람 0.10    대 운영 0.07                  (config.py:66 대 run_eod.ps1:212)
#     ⇒ ★★해달별님께 매일 가는 「동시호가에 지정가 매수주문을 제출하세요」 지시의
#       ★**비중이 같은 날 20:30 계획보다 클다**었다.
#   ★게이트 하나(`S2_CAND_SYNC_OPS`)로 묶었다 — ★기본 off = ★종전 비트동일.
#   ★되돌리기 — ★아래 `S2_CAND_SYNC_OPS` 한 줄을 "0" 으로(나머지 줄은 그때 무시된다).
#   ★값의 정본은 `run_eod.ps1` 이다 — ★거기가 바뀌면 ★여기도 함께 바꿔야 한다(⚠️★손복사라 어긋난다 — 그것이 이 사고의 기제다).
#   ⚠️★이번 범위 밖 2개 — ★매도목표 4단(cfg 에 3칸뿐) · ★재진입 게이트 2단 라벨(`CAND-2026-10-20-35`).
#   → quant_infra/2026-10/S2_REENTRY_SIGNAL_TVLB_GRID_2026-10-24.md §3-2 · §3-6
$env:S2_CAND_SYNC_OPS = "1"                                            # ★알람을 운영 채택값과 동기(기본 off)
$env:S2_SIZE_ABOVE    = "0.15"                                         # 120일선 위 사이즈 15% NAV   (= run_eod.ps1:222)
$env:S2_SIZE_BELOW    = "0.054167"                                     # 120일선 아래 5.4167% NAV     (= run_eod.ps1:249)
$env:S2_MAX_LEV       = "1.0"                                          # ★무차입(단계 1)            (= run_eod.ps1:262)
$env:S2_ADD_DROP      = "0.07"                                         # 추가매수 -7%                (= run_eod.ps1:212)

# ★★★[2026-10-28 채택 · `CAND-2026-10-28-9` · ★★해달별님 결정] MA20 정지봉 오염 진입차단.
#   ★무엇 — 거래정지일(open=high=low=0)의 ★반복 종가가 ★ma20 20일 창에 들어가
#     ★support = ma20 x (1−ep) 를 ★틀린 자리에 세우고 ★가짜 진입 신호를 만든다.
#   ★정밀 설계 — ★ma_period 통째가 아니라 ★sig_raw & ~sig_ex 인 날만 막는다
#     (★광범위 대비 차단 112,592 → 318 종목-일 · 정밀도 34.5% → 83.3%).
#   ★운영 재검정(--dry-run --end 2024-12-31 · 3런) — ★off 재현 8/8 SHA256 비트 동일 ·
#     ★발동 253 종목-일 · ★peak·trough 날짜 동일 · ★MDD −6.48% 불변 ·
#     ★절대손실 26,345,364 → 23,954,994원(−2,390,370) · ⚠️★ΔCAGR −1.05%p(15.66 → 14.61).
#   ⚠️★★「성과 개선」으로 쓰지 말 것 — ★순수 비용이고 ★근거는 ★무결성(가짜 진입 제거)이다.
#     ★선례 S2_EXRIGHTS_BLOCK(③ 0.0242 미달 · 순 −739만 · 무결성 채택)보다 ★5.5배 비싸다.
#   ⚠️★비용의 2/3 는 ★차단이 아니라 ★경로 의존이다(차단 +1,261만 대 신규 −1,349만 + 재배분 −1,287만).
#   ★되돌리기 — ★이 줄을 "0" 으로 바꾸거나 삭제(기본 off).
#   근거: quant_infra/2026-10/S2_RESISTANCE_SYMMETRY_CENSUS_2026-10-28.md §7·§8
#         quant_infra/prereg/2026-10-28_S2_MA20_SKIP_HALT_운영이식.md
$env:S2_MA20_SKIP_HALT = "1"                                   # ★정지봉 오염이 만든 가짜 진입만 차단(정밀)
& C:\Python314\python.exe "s2-trading-web\scripts\export_preclose.py" *>> $log
# ★★[2026-08-24 · CAND-2026-08-23-630] rc 를 로그에 남긴다(로그만 더한다 · ps1 rc 불변).
# ★★★[2026-08-24 신설 · CAND-2026-08-24-520] 아래 [RC] 줄을 ★try/catch 로 감싼다.
#   ★문제 — 이 ps1 은 `$ErrorActionPreference = "Stop"` 이라
#     ★맨몸 `Out-File` 이 ★새 ★중단 지점이다(디스크 가득 · 파일 잠김 · 경로 소실 · 권한).
#     ★★그 중단이 ★뒷 단계 ★앞에서 나면 ★그 단계가 통째로 안 돌고,
#     ★맨 끝에서 나면 ★성공한 실행이 ★rc=1 로 보인다 — ★둘 다 ★로그 한 줄 때문이다.
#   ★★해달별님 결정(2026-08-24) — ★`$ErrorActionPreference` 는 ★Stop ★유지하고
#     ★대신 [RC] 줄만 감싼다. ★근거 — export_eod.py 를 --dry-run 없이 돌리면
#     ★Supabase 9테이블을 ★전삭제 후 재적재한다. ★★중간에 죽는 것보다 ★안 시작하는 것이 안전하다.
#     ★즉 ★Stop 은 ★설계이고, ★고칠 것은 ★「로그가 새 중단 지점이 된 것」 하나다.
#   ⚠️★★rc 는 ★먼저 변수에 담는다 — ★try 안에 나중에 네이티브 호출이 끼면 ★값이 밀린다.
#   ★★ps1 의 자기 exit code 는 ★안 바뀐다 — ★로그만이다.
#   ★되돌리기 — 각 사이트에서 `$rc... = $LASTEXITCODE` · `try {` · `} catch { ... }` 세 줄을 지우고
#     [RC] 줄의 `$rc...` 를 `$LASTEXITCODE` 로 되돌린다(★다른 변경 없음).
#   근거: quant_infra/2026-08/OPS_RC_TRYCATCH_2026-08-24.md
$rcPre = $LASTEXITCODE
try {
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  [RC] export_preclose.py=$rcPre" | Out-File -Append -Encoding utf8 $log
} catch { Write-Host "[RC] 로그 기록 실패(export_preclose.py): $($_.Exception.Message)" }
# ★[2026-08-24 · 검토가 잡은 회귀 수리] ★맨몸 카나리아 — 위 [RC] 가 try/catch 안이라
#   ★로그 쓰기 실패를 ★삼킬 수 있다(rc 탐지 채널 1 → 0). ★이 줄로 ★그 채널을 되살린다
#   (run_eod.ps1 의 "===== eod done =====" 과 같은 설계 · 의도적으로 감싸지 않는다).
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ===== preclose done =====" | Out-File -Append -Encoding utf8 $log
