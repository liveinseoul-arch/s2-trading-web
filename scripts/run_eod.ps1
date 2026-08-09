# 15:45 장마감 후 — 캐시에 당일 EOD 저장 후 전구간 재계산 → Supabase + 텔레그램
$ErrorActionPreference = "Stop"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "eod.log"
"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') eod =====" | Out-File -Append -Encoding utf8 $log
& C:\Python314\python.exe "main.py" --no-gsheets *>> $log               # 당일 EOD 캐시 갱신
$env:S2_TIME_STOP_DAYS = "15"                                          # 기간 손절 3주
$env:S2_SELL_TARGETS = "3,5,7"                                         # 분할매도 +3/+5/+7 (분봉 재검증 채택: 넓은목표는 되밀림 손절多)
# ★2026-08-09 채택 — MA120 위 진입분만 +3/+6.5/+10. 아래(진입의 약 65%)는 위 3/5/7 그대로.
#   되돌리기: 이 한 줄만 지우면 원복(게이트 미설정 = 전 포지션 3/5/7).
#   ★1차 3.0% 를 안 바꾼 것이 핵심 — p["stop"]=1차목표가 이므로 손절 무장 시점이 불변이고,
#     그 뒤 2·3차만 넓히는 것은 이익 확정 손절이 이미 걸린 상태라 하방 위험이 안 늘어난다.
#   운영 dry-run: 결정창(-2024) Calmar 0.5316→0.5598 · 전구간 0.9315→0.9813 · MDD -13.43→-13.38 (양 창 개선)
#   분봉 실현율(MA120 위) 88.3%→90.7% · 3단계 +10% 는 82.9%→92.0% (목표가상 체류 30분→200분)
#   근거: quant_infra/2026-08/KR_S2_COND_SELL_ADOPT_2026-08-09.md
$env:S2_SELL_TARGETS_ABOVE = "3,6.5,10"
$env:S2_SELL_STAGE_PCT = "0.333"                                       # 33/33/33 프론트로딩 (분봉 실현 +0.06%p·승률↑; 일봉 열세는 +7 낙관 착시)
$env:S2_ADD_DROP = "0.07"                                              # 추가매수 -7% (Calmar 1.13)
$env:S2_SIZE_ABOVE = "0.18"                                            # 120일선 위 사이즈 18% NAV
$env:S2_SIZE_BELOW = "0.09"                                            # 120일선 아래 사이즈 9% NAV
$env:S2_MAX_LEV = "1.2"                                                # 레버리지 1.2 (1.3→1.2, 필터와 함께 CAGR·Calmar 유지·마진부담↓)
# ★★2026-08-09 채택 — 낙주필터(S2_ENTRY_MIN_RET5) 제거. 아래 줄이 있던 자리다.
#     $env:S2_ENTRY_MIN_RET5 = "-0.30"    ← 되돌리려면 이 줄을 여기에 다시 넣는다.
#   [왜 뺐나] 채택 근거(2026-07-19 CAGR +1.2%p · Calmar 0.85→0.89)는 **레버1.2 한정**이었고,
#     같은 실험이 MDD −12.60→−13.44 악화 · **무차입(1.0) Calmar 0.77→0.74 열위**를 함께 적었다.
#     해달별님의 실제 운영 의향은 무차입이므로 그 조건이 주 시나리오가 아니다.
#   [재검정 2026-08-09]
#     · canonical(복구본 full3 · 무차입 · 결정창–2024): Calmar 0.8361→0.7148 · MDD −17.37→−19.80 (양쪽 악화)
#     · 운영 dry-run 전구간은 반대로 보였으나(8/8 켜는 쪽 우위) **그 이득은 2015-07-20 단일 사건**에서 나온다.
#       그 날짜는 stock_cache.db 의 거래대금이 close×volume 로 최대 799배 부풀려진 구간(2019-03-11 이전)이라
#       자격 판정 자체가 틀린 시기다. 필터가 그것을 우연히 막고 있었다.
#     · **2019-03-11 이후로만 자르면 3/4 절단이 뒤집히고 CAGR 은 4/4 전부 끄는 쪽이 높다.**
#     · 블록 부트스트랩 48/48 「구별 불가」 — 근거는 통계적 유의성이 아니라 위 구조다.
#   ⚠️레버 1.2 는 2026-07-19 에 이 필터와 **한 묶음으로** 채택됐다. 필터를 뺐으므로 레버 축 재검토가 남아 있다.
#   근거: quant_infra/2026-08/KR_S2_KNIFE_FILTER_2026-08-09.md
$env:S2_COSTS = "1"                                                    # 매수 0.015% / 매도 0.265% 적용
& C:\Python314\python.exe "s2-trading-web\scripts\export_eod.py" *>> $log  # executions/보유/거래/카운트/후보 적재
