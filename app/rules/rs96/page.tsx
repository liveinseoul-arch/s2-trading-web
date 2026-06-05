import { Section } from "@/components/ui";

export const revalidate = 3600;

export const metadata = {
  title: "규칙 (RS96+) — 마감지기",
  description:
    "주간 상대강도(RS) 96 이상 종목을 추적하는 O'Neil CANSLIM · Minervini SEPA 변형 룰. RS 정의, 시장별 시총 필터, 데이터 소스, 갱신 주기.",
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
    t: "일본(JP) 시총 필터 — 보류",
    d: "yfinance 가 일본 종목 발행주식수를 안정적으로 제공하지 않아 시총 필터를 보류합니다(커버리지 ~34%, 도요타·소니·미츠비시UFJ 등 대형주 누락). 33.9% 커버리지로 강제 적용 시 진짜 대형주가 RS96+ 에서 빠지는 더 큰 왜곡 발생. 도쿄거래소 3,667종목 전체 RS96+ 표시로 운영하며, 별도 데이터 소스(JPX 공식·EOD API 등) 도입 시 강화 예정.",
  },
  {
    t: "RS96+ 의 의미와 한계",
    d: "RS96+ 는 '지난 1년 상승률이 시장 상위 4%' 라는 신호이지, 그 자체로 매수 시점은 아니다. Minervini SEPA 에서는 추가로 추세 템플릿(가격이 200일선 위·200일선 상승·150일선이 200일선 위)과 VCP(Volatility Contraction Pattern) 돌파를 함께 본다.",
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
          <li>John Murphy — <i>Technical Analysis of the Financial Markets</i></li>
          <li>Marcos López de Prado — <i>Advances in Financial Machine Learning</i> Ch.11–15 (백테스트 과적합·DSR)</li>
        </ul>
      </Section>
    </>
  );
}
