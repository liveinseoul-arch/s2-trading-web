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
    t: "③ EMA 트레일링 (HOLDTIME 옵션)",
    d: "이익이 쌓인 종목은 손절을 이평선으로 전환: 이익 +20%↑ 또는 보유 20일↑ → −8% 고정손절 제거하고 21일 EMA 이탈로 보호, +50%↑ 또는 50일↑ → 50일 EMA로 완화. 큰 추세주를 너무 일찍 털지 않기 위한 장치(기본 OFF, 토글).",
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

export default function RulesRsPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">규칙 (RS96+)</h1>
      <p className="mb-4 text-xs text-muted">
        주간 상대강도 96 이상 종목 추적의 정의·필터·한계. RS96+ 화면(<a href="/rs96" className="text-accent hover:underline">/rs96</a>)에서 보이는
        종목 리스트는 모두 이 규칙으로 산출됩니다.
      </p>

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
