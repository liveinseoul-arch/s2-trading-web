import { Section } from "@/components/ui";

export const revalidate = 3600;

const RULES: { t: string; d: string }[] = [
  { t: "진입 조건", d: "직전 60거래일 내 거래대금 ≥ 5,000억 스파이크 + 당일 종가 < 20일선 −20%(Envelope) + 거래대금 리셋(최종 매도 후 새 스파이크 필요)." },
  { t: "매수 비중(사이징)", d: "진입가가 120일선 위면 NAV 15%, 아래면 7.5%. 직전 스파이크 봉이 음봉이면 ×0.8(12% / 6%)." },
  { t: "추가매수", d: "직전 매수가 −10%마다 추가매수, 최대 3차. 1차와 동일 금액(정액). 단 2차 매수 후 3차 매수 가격이 직전 최저가보다 낮을 때는 신저가 손절 감시와 충돌하므로 감시주문에서 제외 (broker 우선 체결 모호성 회피)." },
  { t: "분할매도", d: "평단 +3% / +5% / +7%에서 10% / 10% / 80% 매도." },
  { t: "손절", d: "분할매도 한 단계가 체결되면 그 단계가를 손절가로 상향. 2차 매수 후엔 신저가 손절(직전 최저가 하향 시 종가 청산)." },
  { t: "기간 손절", d: "1차 매수 후 15영업일(약 3주) 안에 분할매도 1차(+3%)도 못 찍으면 그 종가에 강제 청산. 화석 포지션 누적 차단 + 자본 회전 ↑." },
  { t: "주문 실무", d: "1차 매수=마감 동시호가에 지지선 지정가. 2·3차 매수=직전매수가×0.9 감시주문. 매도·손절=감시주문." },
  { t: "위험 관리", d: "레버리지 1.3배 상한(초과 매수 미실행). 기준자본 1억." },
];

export default function RulesPage() {
  return (
    <>
      <h1 className="mb-3 text-lg font-bold">S2 매매 규칙</h1>
      <Section title="규칙 요약">
        <ul className="flex flex-col gap-3">
          {RULES.map((r) => (
            <li key={r.t}>
              <div className="font-medium text-accent">{r.t}</div>
              <div className="text-sm text-muted">{r.d}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="검증 성과 (정직 공개)">
        <ul className="flex flex-col gap-2 text-sm">
          <li><b>11.8년(2014-08~2026-06, 현재 유니버스, 무비용 모델 · 3주 기간 손절·시초 매도·추가매수일 매도 보류·broker 충돌 시 3차 매수 skip 적용)</b>:
            CAGR <b className="text-accent">~8.8%</b> · MDD <b className="text-accent">~−10.8%</b> ·
            Calmar <b className="text-accent">~0.82</b> · 승률 ~86%.</li>
          <li className="text-muted">기간 손절 미적용 시(이전 버전): CAGR ~5.7% · MDD ~−31% · Calmar ~0.18. 3주 기간 손절이 2018·2020 큰 폭락 손실의 핵심 해소 요인.</li>
          <li><b>참고 — 7.2년(2019-03~) 부분 기간 (기간 손절 미적용)</b>: CAGR ~12% · MDD ~−11% · Calmar ~1.1. 2018·2020 큰 폭락 제외라 부풀어짐.</li>
          <li><b>12년 시점-정확(상폐 포함, 생존편향 제거, 옵션 B·기간 손절 미적용)</b>: CAGR ~9% · Calmar ~0.7 — quantBacktest 별도 결과.</li>
          <li className="text-muted">본 서비스 표시값은 무비용·0버퍼 모델(주문가 기준)로,
            실제 결과는 슬리피지·수수료·거래세·체결 현실성으로 더 낮을 수 있음.</li>
        </ul>
      </Section>

      <Section title="한계·주의">
        <ul className="flex flex-col gap-2 text-sm text-muted">
          <li>• 당일 −1% 손절(1차 매도일의 ~49%)은 장중 이벤트라 저녁 감시주문만으론 못 따라감 → 텔레그램 알림(Phase 2)으로 보완 예정.</li>
          <li>• 모델 포트폴리오를 KRX 시세로 추적하며, 사용자 증권계좌와 연동되지 않음.</li>
          <li>• 자본 규모가 커지면 거래대금 대비 슬리피지·체결 현실성 한계가 커짐.</li>
        </ul>
      </Section>
    </>
  );
}
