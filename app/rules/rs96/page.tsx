import { Section } from "@/components/ui";

export const revalidate = 3600;

export const metadata = {
  title: "규칙 (RS96+) — 선두지기",
  description:
    "주간 상대강도(RS) 96 이상 종목을 추적하는 O'Neil CANSLIM · Minervini SEPA 변형 룰. RS 정의, 시장별 시총 필터, 데이터 소스, 갱신 주기, 매수·매도 조건.",
};

const RULES: { t: string; d: string }[] = [
  {
    t: "RS(Relative Strength) 정의",
    d: "백분위 0~99. 매 주차에 모든 종목의 52주 가중 모멘텀(composite return) 분포를 만들어, 그 종목이 분포의 몇 백분위인지를 등급화. RS 96 = 상위 4%. IBD/Minervini 의 표준 정의와 동치.",
  },
  {
    t: "Composite Return — 52주 가중 모멘텀",
    d: "12주·24주·36주·48주 누적 수익률 4개를 가중평균. 12주 가중치 2배, 나머지 1배 → 분모 5. 단기 모멘텀에 더 큰 비중. 4개 중 누락분이 있으면 가능한 항만으로 가중치 비례 축소.",
  },
  {
    t: "유니버스 필터",
    d: "한국: 주가 ₩3,000 이상 / 주간 거래대금 500억 이상 / 52주 고가 -30% 이내. 미국: 주가 $5 이상 / 주간 거래대금 $200M 이상 / 52주 고가 -30% 이내. 상장 52주 미만 종목 제외.",
  },
  {
    t: "한국(KR) 시총 필터",
    d: "시총 상위 40% AND 시총 ≥ 5,000억 (₩500B). 두 조건을 모두 충족해야 표시. 소형주 노이즈와 분할/액면병합 미보정 outlier를 추가로 제거.",
  },
  {
    t: "미국(US) 시총 필터",
    d: "시총 상위 20%. 5,972종목의 발행주식수(yfinance 스냅샷) × 그 주차 종가로 시총 산출. 절대 floor 없음 — 백분위 컷오프만 적용.",
  },
  {
    t: "일본(JP) 시총 필터",
    d: "시총 상위 20% AND 1,500억엔 이상. 두 데이터 source 결합: ① finance.yahoo.co.jp 직접 시총(200개) ② Google Finance 직접 시총(3,387개). 통합 99% 커버(3,632/3,667 종목)로 진짜 시장 상위 20% 컷오프 적용. 도요타(¥45兆)·소프트뱅크그룹(¥42兆)·도쿄일렉트론·무라타·파나소닉 등 대표 대형주 모두 포함. 가장 작은 통과 종목 ¥1,564億 = 1,500억엔 floor 가 실효적으로 작동. 미커버 35개(<1%)는 자동 제외. KR 5,000억·US 상위 20%와 유사한 노이즈 제거 수준.",
  },
  {
    t: "RS96+ 의 의미와 한계",
    d: "RS96+ 는 '지난 1년 상승률이 시장 상위 4%' 라는 신호이지, 그 자체로 매수 시점은 아니다. Minervini SEPA 에서는 추가로 추세 템플릿(가격이 200일선 위·200일선 상승·150일선이 200일선 위)과 VCP(Volatility Contraction Pattern) 돌파를 함께 본다.",
  },
  {
    t: "주봉 정배열 · 거래량 역배열 (보조 표시)",
    d: "한규범 『주도주 사이클 절대법칙』의 주봉 4·13·26·52주 이동평균 정배열을 보조 정보로 표시한다. '정배열' 값은 양수=정배열 연속 유지 주수(트렌드 나이), 음수=N주 전 정배열 붕괴(예: 6w 적색=6주 전 깨짐). 상세 페이지에는 거래량 4주<26주 MA(역배열) 여부와 주가·거래량 이동평균 값도 함께 표기한다. 다만 자체 데이터 검증 결과 정배열은 RS96+ 와 상당히 중복(확인·트렌드 나이 용도)되고 거래량 역배열은 매도 우위(알파)가 확인되지 않았다. 따라서 둘 다 매매 신호가 아니라 '상태 표시'로만 활용한다.",
  },
  {
    t: "분할/액면병합 미보정 outlier 주의",
    d: "quantBacktest 의 weekly cache 는 분할·액면병합 보정이 누락된 종목이 있을 수 있어 comp_return 이 +100,000% 같은 극단값으로 나오기도 한다. RS 등급은 백분위 순위라 outlier 영향을 받지 않으니, 화면에서는 RS 값을 기준으로 판단할 것.",
  },
  {
    t: "데이터 소스",
    d: "한국: FinanceDataReader (KRX 공식) + collect_mktcap_kr_v2 (pykrx, 28일 간격 시총 이력). 미국: yfinance + FinanceDataReader (NYSE+NASDAQ) + _bt_shares_us.pkl (발행주식수 스냅샷). 일본: 15_RS_JP_screen (yfinance, 도쿄거래소 프라임/스탠다드/그로스).",
  },
  {
    t: "갱신 주기",
    d: "매주 토요일 02:00 자동 작업(S2_rs_weekly): ① KR daily→weekly 재구성 ② 14_RS_KR_pykrx — KR 주간 OHLCV·RS 임계값 ③ 13_RS_US_screen — US 주간 OHLCV·RS 임계값 ④ 15_RS_JP_screen — JP 주간 OHLCV ⑤ Supabase 동기화. 최근 52주만 적재.",
  },
];

// 백테스트/실전 실행 엔진(17_88)의 기계적 매매 규칙.
// 위 RS96+ 화면은 "후보 풀"이고, 아래는 그 후보를 실제로 사고파는 규칙 — 성과(백테스트)가 이 규칙으로 산출된다.
const BUY_RULES: { t: string; d: string }[] = [
  {
    t: "① 진입 신호 — RS 96+ & 시장 M-필터 ON",
    d: "주간 RS가 96 이상으로 '신규' 진입한 종목만 매수 대상. 여기에 시장상태(M-필터) 게이트를 함께 건다: 지수(KOSPI/S&P500/N225)의 분산일(distribution day) 누적과 FTD(Follow-Through Day, 반등 4일차+ 1.7%↑ & 거래량 증가)로 시장을 ON/OFF 판정. OFF 구간에서는 RS 96+ 라도 신규 매수를 하지 않는다. 약세장 진입을 원천 차단하는 핵심 장치.",
  },
  {
    t: "② 체결 시점 — 다음 주 시가",
    d: "금요일 종가로 주간 RS가 확정되면, 다음 주 첫 거래일 시초가에 매수. (옵션 '조기진입': RS 90~95 종목을 월~목에 감시해 RS96 커트라인 주가에 도달하면 다음날 시초가에 진입 — 금요일 확정보다 최대 3영업일 빠름. 지수로 시장 보정.)",
  },
  {
    t: "③ 포지션 크기 — ATR 리스크 사이징",
    d: "기본은 변동성 기반: 2×ATR(20일) 손실이 총자본의 0.5%가 되도록 투자금액을 역산 → 변동성 큰 종목은 작게, 작은 종목은 크게. ATR 산출 불가 시 fallback 5%. (사이징 OFF 시 고정 비율: 이익·자산성장(C/A) 통과 10% / 미통과 5% / 미통과+RS99 7%.) 총 익스포저 상한으로 전체 레버리지 제한.",
  },
  {
    t: "④ 재진입 쿨다운",
    d: "손절로 청산한 종목은 이후 8주간 재매수 금지. 같은 자리에서 반복 손절되는 '휩쏘 누수'를 차단.",
  },
];

const SELL_RULES: { t: string; d: string }[] = [
  {
    t: "① 손절 — max(매수가 −8%, 고점 −25%)",
    d: "유효 손절가는 두 값 중 높은 쪽. 매수 직후엔 매수가 −8%가 바닥. 이익이 나면 '보유 중 고점 −25%' 트레일링 라인이 위로 올라오며 −8%를 대체 → 수익을 보호하며 추세를 최대한 태운다. 도달 시 전량 매도.",
  },
  {
    t: "② RS 이탈 — 주간 RS ≤ 87",
    d: "상대강도가 87 이하로 떨어지면(주도력 상실) 가격 손절 전이라도 전량 청산. 진입 96 / 청산 87 의 히스테리시스로 잦은 회전을 억제.",
  },
  {
    t: "③ EMA 트레일링 — 수익 구간별 단계 승격",
    d: "기본 모드: 보유 중 고점 수익(peak gain)이 +20%에 도달하면 21일 EMA 종가 이탈 트레일이 켜지고, +50% 도달 시 50일 EMA(더 느슨한 트레일)로 승격된다. 한 번 승격되면 되돌아가지 않으며, −8% 손절은 단계와 무관하게 항상 병행 활성. (HOLDTIME 토글 시 보유 20일/50일 초과가 OR 조건으로 추가되고 EMA 단계에서 −8%가 해제되지만 기본 OFF.) 아래 '매도 트리거 · 활성 조건' 표 참조.",
  },
  {
    t: "④ 상장폐지 강제 청산",
    d: "상폐일이 제공되면 매수 필터에서 우선 제외하고, 보유 중 상폐 도달 시 정리매매 마지막 가용 종가로 강제 청산. ※ KR만 상폐 이력 캐시 보유 → US·JP 백테스트는 상폐 보정이 없어 옛 구간 수익률이 낙관 편향(생존편향)될 수 있음.",
  },
  {
    t: "부분매도 없음 · 전량 원칙",
    d: "피라미딩(분할 추가매수)이나 분할 익절 없이 전량 보유·전량 매도. 위 매도 트리거는 '가장 먼저 충족되는 것'이 작동한다.",
  },
];

// 매도 트리거·활성 조건 (17_88 엔진 기본 모드). 기준값 = 보유 중 최고가 기준 수익률(peak gain).
const SELL_STAGES = [
  {
    stage: "① −8% 손절",
    arm: "항상 활성 (진입 직후부터)",
    trigger: "장중 저가가 손절가 이하 (갭 하락 시 시가 체결)",
    note: "이익이 나면 고점 −25% 트레일 라인이 −8%를 위로 대체",
  },
  {
    stage: "② 21EMA 트레일",
    arm: "peak gain ≥ +20% 도달 이후",
    trigger: "일봉 종가가 21일 EMA 이하",
    note: "+20~50% 구간의 중형 이익 회수 창구",
  },
  {
    stage: "③ 50EMA 트레일",
    arm: "peak gain ≥ +50% 도달 이후 (②를 대체)",
    trigger: "일봉 종가가 50일 EMA 이하",
    note: "변동성을 견디며 대시세를 끝까지 추적. 승격 후 미복귀",
  },
  {
    stage: "④ RS 이탈",
    arm: "항상 활성",
    trigger: "주간 RS ≤ 87",
    note: "주도력 상실 시 최후 안전망",
  },
];

// 매도 사유별 실현 수익률 분포 — 백테스트: US, 2019-08-12~2026-04-17, 17_88 엔진,
// 재진입 없음 · 손절 후 8주 쿨다운 · ATR 사이징(리스크 0.7%) · C/A 비활성. 총 646건, CAGR 19.5%.
const SELL_DIST = [
  { r: "50EMA 이탈", n: "63 (9.8%)", mean: "+75.0%", med: "+52.2%", rng: "−4.0 ~ +341%", win: "96.8%", contrib: "+158%", hold: "93일" },
  { r: "21EMA 이탈", n: "113 (17.5%)", mean: "+12.4%", med: "+11.1%", rng: "−3.7 ~ +35%", win: "94.7%", contrib: "+61%", hold: "44일" },
  { r: "기간종료(미청산)", n: "11 (1.7%)", mean: "+27.1%", med: "+8.6%", rng: "−1.5 ~ +181%", win: "90.9%", contrib: "+17%", hold: "18일" },
  { r: "RS하락(≤87)", n: "9 (1.4%)", mean: "+1.5%", med: "−0.7%", rng: "−8.0 ~ +22.6%", win: "44.4%", contrib: "+0.3%", hold: "59일" },
  { r: "손절(−8%)", n: "405 (62.7%)", mean: "−8.0%", med: "−8.0%", rng: "−8.0% 고정", win: "0%", contrib: "−117%", hold: "8일" },
  { r: "손절(갭하락)", n: "45 (7.0%)", mean: "−11.3%", med: "−9.2%", rng: "−62.4 ~ −8.0%", win: "0%", contrib: "−20%", hold: "17일" },
];

const TH = "px-2 py-1.5 text-left font-medium whitespace-nowrap";
const TD = "px-2 py-1.5 whitespace-nowrap";

export default function RulesRsPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">규칙 (RS96+)</h1>
      <p className="mb-4 text-xs text-muted">
        주간 상대강도 96 이상 종목 추적의 정의·필터·한계. RS96+ 화면(<a href="/rs96" className="text-accent hover:underline">/rs96</a>)에서 보이는
        종목 리스트는 모두 이 규칙으로 산출됩니다.
      </p>

      <Section title="실제 전략 성과 (한국)">
        <p className="text-sm leading-relaxed text-muted">
          아래 규칙으로 한국 시장을 백테스트한 <b>월별·연도별 성과</b>는{" "}
          <a href="/performance" className="text-accent hover:underline">성과 화면(/performance)</a>에서 확인할 수 있습니다.
          채택 구성: <b>RS96+ ∩ 영업이익 C≥25% ∩ 거래대금 상위 20%</b> + ATR 리스크 0.7%(2×ATR) 사이징
          + −8% 손절 · 21/50일 EMA 트레일링. 2017~2026 결과 <b>CAGR 12.7% · MDD −24.9% · Calmar 0.51</b>
          (원화 기준 3.12배). 저승률(31%)·고손익비 순정 모멘텀 — 청산의 65%가 −8% 손절로 빠르게 잘리고
          살아남은 소수 승자를 EMA 트레일로 크게 태운다. 시총 상위 20/25% 게이트는 이미 거래대금·복합필터에
          포함돼 무효과였고, <b>거래대금 상위 20%</b>가 유효했다.
        </p>
      </Section>

      <Section title="규칙 상세">
        <ul className="flex flex-col gap-3">
          {RULES.map((r) => (
            <li key={r.t}>
              <div className="font-medium text-accent">{r.t}</div>
              <div className="text-sm text-muted leading-relaxed">{r.d}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="매수 조건 (전략 실행 · 백테스트 기준)">
        <p className="mb-3 text-sm leading-relaxed text-muted">
          위 RS96+ 리스트는 <b>후보 풀</b>이고, 아래는 그 후보를 실제로 <b>사고파는 기계적 규칙</b>입니다.
          백테스트 성과는 전부 이 규칙(17_88 엔진)으로 산출됩니다. 전량 보유·전량 매도, 부분매도·피라미딩 없음.
        </p>
        <ul className="flex flex-col gap-3">
          {BUY_RULES.map((r) => (
            <li key={r.t}>
              <div className="font-medium text-accent">{r.t}</div>
              <div className="text-sm text-muted leading-relaxed">{r.d}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="매도 조건 (가장 먼저 충족되는 것)">
        <ul className="flex flex-col gap-3">
          {SELL_RULES.map((r) => (
            <li key={r.t}>
              <div className="font-medium text-accent">{r.t}</div>
              <div className="text-sm text-muted leading-relaxed">{r.d}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="매도 트리거 · 활성 조건 (기본 모드)">
        <p className="mb-2 text-sm leading-relaxed text-muted">
          매도 규칙은 수익 구간에 따라 3단계로 <b>승격</b>됩니다. 기준값은 현재 평가손익이 아니라
          <b> 보유 중 최고가 기준 수익률(peak gain)</b> — 장중 고가로 갱신되며 단조 증가합니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-muted">
            <thead>
              <tr className="border-b border-[var(--color-borderc)] text-accent">
                <th className={TH}>단계</th>
                <th className={TH}>활성 조건</th>
                <th className={TH}>매도 트리거</th>
                <th className={TH}>비고</th>
              </tr>
            </thead>
            <tbody>
              {SELL_STAGES.map((s) => (
                <tr key={s.stage} className="border-b border-[var(--color-borderc)] last:border-0 align-top">
                  <td className={`${TD} font-medium`}>{s.stage}</td>
                  <td className={TD}>{s.arm}</td>
                  <td className={TD}>{s.trigger}</td>
                  <td className="px-2 py-1.5">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          0~+20% 구간은 −8% 손절만 작동. +20% 도달 후 21EMA, +50% 도달 후 50EMA로 트레일이
          느슨해지며 대시세를 추적한다. 상장폐지 시에는 정리매매 마지막 가용 종가로 강제 청산.
        </p>
      </Section>

      <Section title="매도 사유별 실현 수익률 분포 (백테스트)">
        <p className="mb-2 text-sm leading-relaxed text-muted">
          US · 2019-08-12 ~ 2026-04-17 · 17_88 엔진(재진입 없음, 손절 후 8주 쿨다운, ATR 사이징
          리스크 0.7%, C/A 비활성) · 총 646건 · CAGR 19.5% / MDD −26.3% 런 기준.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-muted">
            <thead>
              <tr className="border-b border-[var(--color-borderc)] text-accent">
                <th className={TH}>매도 사유</th>
                <th className={TH}>건수 (비중)</th>
                <th className={TH}>평균</th>
                <th className={TH}>중앙값</th>
                <th className={TH}>최소~최대</th>
                <th className={TH}>승률</th>
                <th className={TH}>손익 기여</th>
                <th className={TH}>평균 보유</th>
              </tr>
            </thead>
            <tbody>
              {SELL_DIST.map((s) => (
                <tr key={s.r} className="border-b border-[var(--color-borderc)] last:border-0">
                  <td className={`${TD} font-medium`}>{s.r}</td>
                  <td className={TD}>{s.n}</td>
                  <td className={TD}>{s.mean}</td>
                  <td className={TD}>{s.med}</td>
                  <td className={TD}>{s.rng}</td>
                  <td className={TD}>{s.win}</td>
                  <td className={TD}>{s.contrib}</td>
                  <td className={TD}>{s.hold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-2 ml-4 list-disc text-xs leading-relaxed text-muted">
          <li>
            이익의 원천은 50EMA 트레일까지 도달한 소수(9.8%)로, 총손익의 158%를 담당. +100% 초과
            대박(16건)은 전부 이 그룹에서 발생.
          </li>
          <li>
            거래의 약 70%는 손절(−8% 정액 + 갭하락)로 끝나며 이익의 137%를 상쇄 — 전형적인
            저승률(28%)·고손익비(2.2) 모멘텀 구조.
          </li>
          <li>갭하락 손절은 평균 −11.3%로 −8% 설계선을 뚫는다(최악 −62.4%).</li>
          <li>RS≤87 청산은 9건뿐 — 트레일이 먼저 작동해 사실상 최후 안전망으로만 기능.</li>
          <li>손익 기여 %는 총손익 대비 비율이라 합계가 100%를 넘는 항목이 존재.</li>
        </ul>
      </Section>

      <Section title="재무(C) 필터 검증 — 미국·한국 상반된 결론 (2026-07)">
        <p className="mb-2 text-sm leading-relaxed text-muted">
          오닐 CANSLIM의 C(분기 이익성장) 필터를 point-in-time 재무 데이터(미국 Sharadar SF1,
          한국 DART 접수일 기준)로 정식 검증한 결과, <b>두 시장의 결론이 정반대</b>로 나왔다.
        </p>
        <ul className="ml-4 list-disc text-sm leading-relaxed text-muted">
          <li>
            <b>미국</b>: 평범한 성장 확인(+25%)은 오히려 독이고, <b>극단적 성장(EPS 배증·흑자전환)만
            매수</b>하면 알파 — 시총 상위 20%와 결합 시 2002~2026(생존편향 보정)에서 Sharpe 0.57로
            S&amp;P500(0.52)을 위험조정 기준 상회, MDD는 지수의 절반 이하(−24% vs −56%).
            walk-forward(2002~14 선택 → 2015~26 검증)도 통과. 단 아래 한국 미재현으로
            <b> 정식 채택이 아닌 미국 한정 참고 전략</b>.
          </li>
          <li>
            <b>한국 — 당기순이익 기준은 무효</b>: 같은 게이트를 순이익으로 걸면 <b>모든 임계값에서
            파괴적</b>(2017~2026 기준선 +14.5% → 게이트 시 −1% 수준). 진입 시점 사후 분류에서
            순이익 배증 통과 그룹이 평균 −1.5%로 미통과 그룹(+4.1%)보다 오히려 나빴고, +50% 대박
            29건 중 16건이 재무 미통과 종목이었다.
          </li>
          <li>
            <b>이유</b>: 한국 상장사의 순이익 급증에는 지분법·평가손익·자산처분익 같은 <b>일회성
            손익 노이즈</b>가 많이 섞이고, 반도체·화학·조선 같은 <b>사이클 산업의 피크 신호</b>인
            경우도 많다. 실적 배증이 공시로 확인되는 시점이 사이클 정점 부근이라 RS96 모멘텀과
            겹치면 꼭대기 매수가 된다. 미국의 배증이 구조적 성장주(신제품·플랫폼)의 초입 신호인
            것과 대조적이다.
          </li>
          <li>
            <b>한국 — 영업이익 기준은 유효 (walk-forward 통과)</b>: 같은 게이트를 <b>영업이익</b>으로
            바꾸면 결과가 반전된다. 영업이익 배증(C≥100%) 게이트는 2017~2026에서 CAGR 14.0%로
            기준선(14.5%)과 대등하면서 <b>MDD는 절반 이하(−21% vs −47%), Sharpe 0.72로 기준선(0.49)과
            KOSPI(0.58)를 모두 상회</b>, 거래는 1/5로 줄었다 — 미국과 동일한 구조의 재현. 자체
            walk-forward(2017~21 선택 → 2022~26 검증)도 통과: OOS에서 게이트가 Sharpe 0.81~0.92로
            기준선(0.77)을 넘고 MDD는 −16~−26%(기준선 −44%)에 그쳤다. 순이익의 일회성 노이즈를
            제거하면 한국에서도 &ldquo;진짜 이익 폭발&rdquo;은 알파다.
          </li>
        </ul>
        <p className="mt-2 text-sm font-medium leading-relaxed text-accent">
          한 줄 요약: 실적 확인형 게이트는 지표를 시장에 맞출 때 작동한다 — 미국은 EPS(순이익)
          배증, 한국은 <b>영업이익</b> 배증. 한국에서 순이익 기준 필터는 일회성 손익 노이즈 탓에
          역신호이므로 적용하지 않는다. 영업이익 게이트는 양 시장 walk-forward를 통과해 채택
          후보이며, 수익 극대(게이트 없음) vs 위험조정 극대(게이트)의 성향 선택지로 운용한다.
        </p>
      </Section>

      <Section title="해석 가이드">
        <p className="text-sm leading-relaxed text-muted">
          이 화면은 <b>후보 풀</b>이지 자동 매수 신호가 아닙니다. 다음 단계는 사용자가 직접 봅니다:
        </p>
        <ul className="mt-2 ml-4 list-disc text-sm leading-relaxed text-muted">
          <li>일봉 차트로 추세 템플릿 확인 (200일선 위, 상승, 150일선 위)</li>
          <li>VCP(Volatility Contraction Pattern) 진행 여부 — 박스 폭이 순차적으로 좁아지는지</li>
          <li>거래량 감소 + 마지막 좁은 박스에서 거래량 동반 돌파(피벗 매수) 시점</li>
          <li>시장 전체 상태(분산일·FTD) — 약세장에선 통과 종목조차 손절률 급증</li>
        </ul>
      </Section>

      <Section title="참고 문헌">
        <ul className="ml-4 list-disc text-sm leading-relaxed text-muted">
          <li>William O&apos;Neil — <i>How to Make Money in Stocks</i> (CANSLIM)</li>
          <li>Mark Minervini — <i>Trade Like a Stock Market Wizard</i> (SEPA·VCP)</li>
          <li>한규범 — <i>주도주 사이클 절대법칙</i> (주봉 4·13·26·52주 정배열 · 공세종말점)</li>
          <li>John Murphy — <i>Technical Analysis of the Financial Markets</i></li>
          <li>Marcos López de Prado — <i>Advances in Financial Machine Learning</i> Ch.11–15 (백테스트 과적합·DSR)</li>
        </ul>
      </Section>
    </>
  );
}
