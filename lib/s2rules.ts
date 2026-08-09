// ═══════════════════════════════════════════════════════════════════════════
//  S2 매매 규칙 — ★단일 출처. 규칙·파라미터를 바꿀 때 **이 파일만** 고치면 된다.
//
//  누가 읽는가
//    /            홈 대시보드 접이식 블록      → S2_RULES
//    /rules/s2    규칙 상세                    → S2_RULES + S2_CONFIG_LINE
//    /rules       규칙 목록 카드               → S2_SUMMARY
//    /dashboard   성과 화면 각주               → S2_CONFIG_LINE
//    /landing     소개 페이지                  → S2_SUMMARY + S2_CONFIG_LINE
//
//  ★운영 실제 설정은 `s2-trading-web/scripts/run_eod.ps1` 의 env 10개다.
//    파라미터를 바꿨으면 **여기 S2_PARAMS 도 함께** 고칠 것. 두 곳이 어긋나면
//    화면이 실제와 다른 규칙을 설명하게 된다.
//
//  본문에서 `**강조**` 를 쓰면 굵게 렌더링된다(components/RuleText.tsx). 의존성 없음.
// ═══════════════════════════════════════════════════════════════════════════

/** 운영 파라미터 — run_eod.ps1 의 env 와 1:1 대응. 문구는 전부 여기서 파생된다. */
export const S2_PARAMS = {
  /** S2_SELL_TARGETS — 120일선 **아래** 진입분 분할매도 목표(%) */
  sellBelow: [3, 5, 7],
  /** S2_SELL_TARGETS_ABOVE — 120일선 **위** 진입분. 빈 배열이면 조건부 매도 off */
  sellAbove: [3, 6.5, 10],
  /** S2_SELL_STAGE_PCT — 1·2차 비중(%). 3차는 잔량 */
  sellStagePct: 33,
  /** S2_ADD_DROP — 추가매수 간격(%) */
  addDrop: 7,
  /** S2_MAX_BUY */
  maxBuy: 3,
  /** S2_SIZE_ABOVE / S2_SIZE_BELOW — NAV 대비 종목당 비중(%) */
  sizeAbove: 18,
  sizeBelow: 9,
  /** S2_MAX_LEV */
  maxLev: 1.2,
  /** S2_TIME_STOP_DAYS — 1차 매도 미달 시 강제청산까지 영업일 */
  timeStopDays: 15,
  /** S2_ENTRY_MIN_RET5 — 낙주 필터(최근 5거래일 수익률 하한, %) */
  entryMinRet5: -30,
  /** 진입 문턱 */
  envelopePct: 20,
  liquidityKrw: "5,000억",
  lookbackDays: 60,
} as const;

const j = (a: readonly number[]) => a.map((x) => `+${x}`).join("/");

/** "120일선 아래 +3/+5/+7 · 위 +3/+6.5/+10" — 조건부가 off 면 한쪽만 */
export const S2_SELL_TEXT: string =
  S2_PARAMS.sellAbove.length > 0 &&
  j(S2_PARAMS.sellAbove) !== j(S2_PARAMS.sellBelow)
    ? `120일선 아래 ${j(S2_PARAMS.sellBelow)}% · 위 ${j(S2_PARAMS.sellAbove)}%`
    : `${j(S2_PARAMS.sellBelow)}%`;

/** 성과 각주·검증 성과에 붙는 "현재 운용값" 한 줄 */
export const S2_CONFIG_LINE: string = [
  `분할매도 ${S2_SELL_TEXT}(${S2_PARAMS.sellStagePct}/${S2_PARAMS.sellStagePct}/${100 - 2 * S2_PARAMS.sellStagePct})`,
  `−${S2_PARAMS.addDrop}% 추가매수(최대 ${S2_PARAMS.maxBuy}차)`,
  `${S2_PARAMS.sizeAbove}%/${S2_PARAMS.sizeBelow}% 사이징`,
  `레버 ${S2_PARAMS.maxLev}`,
  `낙주필터(ret5<${S2_PARAMS.entryMinRet5})`,
  `${S2_PARAMS.timeStopDays}영업일 기간 손절`,
  "시초 매도",
  "추가매수일 매도 보류",
  "broker 충돌 시 3차 매수 skip",
].join("·");

/** 규칙 목록 카드·소개 페이지의 한 문장 요약 */
export const S2_SUMMARY: string =
  `주도주 급락 눌림목 매매. ${S2_PARAMS.lookbackDays}일 내 거래대금 ${S2_PARAMS.liquidityKrw} 스파이크 종목이 ` +
  `20일선 −${S2_PARAMS.envelopePct}% 이탈할 때 동시호가 지정가 진입, 분할매도 ${S2_SELL_TEXT}, ` +
  `거래대금 리셋·신저가 손절.`;

/** 규칙 본문. `**강조**` 사용 가능. */
export const S2_RULES: { t: string; d: string }[] = [
  { t: "진입 조건", d: `직전 ${S2_PARAMS.lookbackDays}거래일 내 거래대금 ≥ ${S2_PARAMS.liquidityKrw} 스파이크 + 당일 종가 < 20일선 −${S2_PARAMS.envelopePct}%(Envelope) + 거래대금 리셋(최종 매도 후 새 스파이크 필요).` },
  { t: "낙주 진입 필터", d: `진입 신호가 나도 최근 5거래일 수익률이 ${S2_PARAMS.entryMinRet5}%보다 나쁜(1주에 30%↑ 폭락) 종목은 진입 제외. 이런 종목은 '블로우오프 후 급락'으로 3차매수까지 가는 낙주 비중이 높아 자본만 묶고 손실 확률이 높다. 걸러낸 자본을 빠른 회전 반등에 재투입 → CAGR +1.2%p·Calmar 0.85→0.89(레버1.2 기준). 전·후반 하위기간 양쪽에서 개선(과최적화 낮음).` },
  { t: "매수 비중(사이징)", d: `진입가가 120일선 위면 NAV ${S2_PARAMS.sizeAbove}%, 아래면 ${S2_PARAMS.sizeBelow}%. 직전 스파이크 봉이 음봉이면 ×0.8(${(S2_PARAMS.sizeAbove * 0.8).toFixed(1)}% / ${(S2_PARAMS.sizeBelow * 0.8).toFixed(1)}%). 12년 백테스트 그리드 최적.` },
  { t: "추가매수", d: `직전 매수가 −${S2_PARAMS.addDrop}%마다 추가매수, 최대 ${S2_PARAMS.maxBuy}차. 1차와 동일 금액(정액). 12년 백테스트로 −${S2_PARAMS.addDrop}% sweet spot 확인. 단 2차 매수 후 3차 매수 가격이 직전 최저가보다 낮을 때는 신저가 손절 감시와 충돌하므로 감시주문에서 제외(broker 우선 체결 모호성 회피).` },
  { t: "분할매도 — ★진입가 120일선 위/아래로 다름", d: `진입가가 120일선 **아래면 평단 ${j(S2_PARAMS.sellBelow)}%**, **위면 평단 ${j(S2_PARAMS.sellAbove)}%**. 각 ${S2_PARAMS.sellStagePct}% / ${S2_PARAMS.sellStagePct}% / ${100 - 2 * S2_PARAMS.sellStagePct}% 매도(균등 프론트로딩). **위/아래는 진입 시점에 정해지고 이후 바뀌지 않는다** — 진입 후 120일선을 오르내려도 목표는 불변이다(실측 노출 1.9% · 3차 목표에서는 0%). 위 진입은 전체의 약 35%다.` },
  { t: "왜 120일선 위만 넓히나", d: `**1차 +${S2_PARAMS.sellBelow[0]}%를 양쪽 다 유지한 것이 핵심**이다. 분할매도 한 단계가 체결돼야 손절이 이익 구간으로 올라오므로(아래 '손절' 항목), 1차를 건드리면 손절 무장이 늦어져 낙폭이 커진다 — 1차를 +3.5%로 올린 안은 **MDD가 1.1%p 악화**하고 1차 체결 실현율도 **91.7%→79.1%**로 떨어졌다. 1차를 그대로 두고 2·3차만 넓히면 이미 이익 확정 손절이 걸린 뒤라 하방 위험이 늘지 않는다. 분봉 실측에서도 **3차 +10%의 체결 실현율이 +7%보다 오히려 높았다(82.9%→92.0%**, 목표가 위 체류 30분→200분) — 강한 추세일 때만 +10%에 닿기 때문이다(선택효과). 12년 dry-run: CAGR 12.51→**13.13%**, MDD −13.43→**−13.38%**(개선). 단 블록 부트스트랩은 **'구별 불가'**(P(Δ>0) 0.92–0.97) — 채택 근거는 통계적 유의성이 아니라 위 구조와 개선의 광범위함(374후보 중 양 창 개선 228)이다. 2026-08-09 채택.` },
  { t: "왜 +2/+6/+14 는 안 쓰나", d: `일봉 백테스트만 보면 더 높지만 그 우위는 **'터치=체결' 가정에 의존**한다 — 분봉 실측상 +14% 3차완결이 절반만 실현(고가 스침≠지정가 체결)돼 두 규칙이 사실상 동률이었다. 목표를 넓히는 것 자체가 문제가 아니라 **너무 멀면 못 판다**가 문제다. 그래서 +10%까지는 채택하고 +14%는 쓰지 않는다.` },
  { t: "손절", d: `분할매도 한 단계가 체결되면 그 단계가를 손절가로 상향(예: +${S2_PARAMS.sellBelow[0]}% 매도 후 손절가 +${S2_PARAMS.sellBelow[0]}% → 최소 +${S2_PARAMS.sellBelow[0]}% 확정). 갭하락 시엔 그 시가로 체결. 2차 매수 후엔 신저가 손절 — 진입 이후 누적 최저가(진입가 및 매일의 저가 중 최소)를 하향하면 그 종가에 청산.` },
  { t: "손절 무장 타이밍", d: "갭하락을 반영한 분봉 실측 결과 '즉시~단시간 무장'이 최적이다. 유예를 길게 둘수록 다음날 갭하락을 더 맞아 손실이 커진다(180분·240분이 즉시보다 열위). 단 무손절은 최악 — 손절은 반드시 걸되 빨리 건다. ※ 손절선은 매도가에 붙임(본전·한단계뒤 사다리는 되밀림 반납이 갭회피 이득보다 커 열위)." },
  { t: "기간 손절", d: `1차 매수 후 ${S2_PARAMS.timeStopDays}영업일(약 3주) 안에 분할매도 1차(+${S2_PARAMS.sellBelow[0]}%)도 못 찍으면 그 종가에 강제 청산. 화석 포지션 누적 차단 + 자본 회전 ↑. MDD 개선의 주역(−33.8% → −12.0%).` },
  { t: "주문 실무", d: `1차 매수=마감 동시호가에 지지선 지정가. 2·3차 매수=직전매수가×${(1 - S2_PARAMS.addDrop / 100).toFixed(2)} 감시주문. 매도·손절=감시주문.` },
  { t: "위험 관리", d: `레버리지 ${S2_PARAMS.maxLev}배 상한(초과 매수 미실행). 낙주 필터와 함께 CAGR·Calmar를 유지하며 마진 부담을 낮춤. 기준자본 1억.` },
];
