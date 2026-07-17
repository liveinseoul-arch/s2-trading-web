import { Section } from "@/components/ui";

export const revalidate = 3600;

const RULES: { t: string; d: string }[] = [
  { t: "진입 조건", d: "직전 60거래일 내 거래대금 ≥ 5,000억 스파이크 + 당일 종가 < 20일선 −20%(Envelope) + 거래대금 리셋(최종 매도 후 새 스파이크 필요)." },
  { t: "매수 비중(사이징)", d: "진입가가 120일선 위면 NAV 18%, 아래면 9%. 직전 스파이크 봉이 음봉이면 ×0.8(14.4% / 7.2%). 12년 백테스트 그리드 최적." },
  { t: "추가매수", d: "직전 매수가 −7%마다 추가매수, 최대 3차. 1차와 동일 금액(정액). 12년 백테스트로 -7% sweet spot 확인. 단 2차 매수 후 3차 매수 가격이 직전 최저가보다 낮을 때는 신저가 손절 감시와 충돌하므로 감시주문에서 제외 (broker 우선 체결 모호성 회피)." },
  { t: "분할매도", d: "평단 +2% / +6% / +14%에서 10% / 10% / 80% 매도. 12년 백테스트로 그리드 최적. 비용(왕복 0.23%)을 반영해 1차 목표를 2.5~3.5%로 올려봐도 모두 열위 — +2% 가 최적(아래 표)." },
  { t: "손절", d: "분할매도 한 단계가 체결되면 그 단계가를 손절가로 상향(예: +2% 매도 후 손절가 +2% → 최소 +2% 확정). 2차 매수 후엔 신저가 손절 — 진입 이후 누적 최저가(진입가 및 매일의 저가 중 최소)를 하향하면 그 종가에 청산." },
  { t: "기간 손절", d: "1차 매수 후 15영업일(약 3주) 안에 분할매도 1차(+2%)도 못 찍으면 그 종가에 강제 청산. 화석 포지션 누적 차단 + 자본 회전 ↑. MDD 개선의 주역(−28.8% → −11.6%)." },
  { t: "주문 실무", d: "1차 매수=마감 동시호가에 지지선 지정가. 2·3차 매수=직전매수가×0.93 감시주문. 매도·손절=감시주문." },
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
          <li><b>11.9년(2014-08~2026-07, 비용 0.215% 적용 · 현재 운용값 = 3주 기간 손절·+2/+6/+14 분할매도·−7% 추가매수·18%/9% 사이징·시초 매도·추가매수일 매도 보류·broker 충돌 시 3차 매수 skip)</b>:
            CAGR <b className="text-accent">16.05%</b> · MDD <b className="text-accent">−11.6%</b> ·
            Calmar <b className="text-accent">1.39</b> · 승률 89.1% <span className="text-muted">(2026-07-17 재측정)</span>.</li>
          <li className="text-muted">분할매도 +3/+5/+7 + drop −10% + size 15/7.5 + 기간손절 없음 (2026-07-17 이전 운용값): CAGR 4.59% · MDD −33.8% · Calmar 0.14.</li>
          <li><b>참고 — 7.2년(2019-03~) 부분 기간 (기간 손절 미적용)</b>: CAGR ~12% · MDD ~−11% · Calmar ~1.1. 2018·2020 큰 폭락 제외라 부풀어짐.</li>
          <li><b>12년 시점-정확(상폐 포함, 생존편향 제거, 옵션 B·기간 손절 미적용)</b>: CAGR ~9% · Calmar ~0.7 — quantBacktest 별도 결과.</li>
          <li className="text-muted">본 서비스 표시값은 무비용·0버퍼 모델(주문가 기준)로,
            실제 결과는 슬리피지·수수료·거래세·체결 현실성으로 더 낮을 수 있음.</li>
        </ul>
      </Section>

      <Section title="파라미터 검증 (2026-07 실측 · 비용 0.215% 반영)">
        <p className="mb-2 text-sm text-muted">
          11.9년(2014-08~2026-07) · 기준자본 1억 · 손절=매도가 상향. 아래 <b>맨 윗줄이 현재 운용값</b>이며
          본 서비스 표시 데이터도 이 설정으로 산출된다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tnum">
            <thead>
              <tr className="text-muted">
                <th className="py-1 text-left">설정</th>
                <th className="py-1 text-right">CAGR</th>
                <th className="py-1 text-right">MDD</th>
                <th className="py-1 text-right">Calmar</th>
                <th className="py-1 text-right">승률</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--color-borderc)]">
                <td className="py-1"><b>+2/+6/+14 · −7% · 18/9 · 기간손절 3주</b></td>
                <td className="py-1 text-right"><b className="text-accent">16.05%</b></td>
                <td className="py-1 text-right"><b className="text-accent">−11.6%</b></td>
                <td className="py-1 text-right"><b className="text-accent">1.39</b></td>
                <td className="py-1 text-right">89.1%</td>
              </tr>
              <tr className="border-t border-[var(--color-borderc)]">
                <td className="py-1 text-muted">└ 기간손절 빼면</td>
                <td className="py-1 text-right">10.10%</td>
                <td className="py-1 text-right">−28.8%</td>
                <td className="py-1 text-right">0.35</td>
                <td className="py-1 text-right">89.2%</td>
              </tr>
              <tr className="border-t border-[var(--color-borderc)]">
                <td className="py-1 text-muted">+3/+5/+7 · −10% · 15/7.5 · 손절없음 (옛 설정)</td>
                <td className="py-1 text-right">4.59%</td>
                <td className="py-1 text-right">−33.8%</td>
                <td className="py-1 text-right">0.14</td>
                <td className="py-1 text-right">86.4%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          <li><b>기간손절이 MDD 개선의 주역</b>: −28.8% → −11.6%. 화석 포지션을 끊어 자본을 회전시킨다
            <span className="text-muted"> (발동은 458건 중 2건뿐 — 자주 쓰여서가 아니라 그 경로 자체를 차단).</span></li>
          <li><b>하위기간 검증 — 세 기간 모두 우위</b>:
            <span className="text-muted"> 전반 6.4년(2014-08~2020-12) <b>+10.00%</b> / MDD −10.4% (옛 설정은 <b>−2.03%</b> / −33.8% — 원금 손실).
            후반 7.8년 <b>20.87%</b> / −11.7% (옛 설정 9.88% / −10.9%).</span></li>
          <li><b>1차 목표 +2% 는 비용을 감안해도 최적</b>:
            <span className="text-muted"> 왕복비용 0.23%가 +2% 이익의 11.5%를 먹지만, 올릴수록 나빠짐
            (2.5%→15.21% · 3%→15.34% · 3.5%→14.81%). 목표를 높이면 평균수익은 오르나(+3.36→+3.51%)
            승률이 떨어져(89.1→82.5%) 손실이 그를 압도. <b>1차 매도는 이익 극대화가 아니라 손절선을
            본전 위로 올리는 스위치</b>라 빨리 켜는 게 유리하다.</span></li>
          <li className="text-muted">⚠ +2/+6/+14·−7% 는 <b>12년 전체 기간 그리드 최적해</b>라 표본내 편향 가능성이 남는다.
            하위기간 일관성은 확인했으나 최적화에 두 기간이 모두 쓰였으므로 <b>진정한 OOS 는 미래 데이터뿐</b>.</li>
        </ul>
      </Section>

      <Section title="거래비용 (실측)">
        <p className="mb-2 text-sm">
          <b>매수</b> 수수료 0.015% · <b>매도</b> 수수료 0.015% + 세금 0.20% = <b>0.215%</b>
          <span className="text-muted"> (세금 = 증권거래세 0.05% + 농어촌특별세 0.15%)</span>
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          <li>본 서비스 표시값(무비용) 대비 비용 반영 시 <b>CAGR −1.25%p</b>:
            <span className="tnum"> 5.84% → <b className="text-accent">4.59%</b></span>
            <span className="text-muted"> (MDD −33.8% · 평균수익 +2.84% · 승률 86.4%, 11.9년)</span></li>
          <li className="text-muted">자본을 11.9년간 63회 회전(연 5.3회)하지만 매도 비용이 0.215%라
            연 드래그는 ~1.2%p 수준. 고회전이지만 비용이 엣지를 삼키지는 않음.</li>
          <li className="text-muted">세율은 2026-07 기준. 세법 개정 시 달라짐.</li>
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
