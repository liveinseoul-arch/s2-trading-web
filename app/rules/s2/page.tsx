import { Section } from "@/components/ui";

export const revalidate = 3600;

const RULES: { t: string; d: string }[] = [
  { t: "진입 조건", d: "직전 60거래일 내 거래대금 ≥ 5,000억 스파이크 + 당일 종가 < 20일선 −20%(Envelope) + 거래대금 리셋(최종 매도 후 새 스파이크 필요)." },
  { t: "낙주 진입 필터", d: "진입 신호가 나도 최근 5거래일 수익률이 −30%보다 나쁜(1주에 30%↑ 폭락) 종목은 진입 제외. 이런 종목은 '블로우오프 후 급락'으로 3차매수까지 가는 낙주 비중이 높아 자본만 묶고 손실 확률이 높다. 걸러낸 자본을 빠른 회전 반등에 재투입 → CAGR +1.2%p·Calmar 0.85→0.89(레버1.2 기준). 전·후반 하위기간 양쪽에서 개선(과최적화 낮음)." },
  { t: "매수 비중(사이징)", d: "진입가가 120일선 위면 NAV 18%, 아래면 9%. 직전 스파이크 봉이 음봉이면 ×0.8(14.4% / 7.2%). 12년 백테스트 그리드 최적." },
  { t: "추가매수", d: "직전 매수가 −7%마다 추가매수, 최대 3차. 1차와 동일 금액(정액). 12년 백테스트로 -7% sweet spot 확인. 단 2차 매수 후 3차 매수 가격이 직전 최저가보다 낮을 때는 신저가 손절 감시와 충돌하므로 감시주문에서 제외 (broker 우선 체결 모호성 회피)." },
  { t: "분할매도", d: "평단 +3% / +5% / +7%에서 33% / 33% / 34% 매도(균등 프론트로딩). 일봉 백테스트만 보면 +2/+6/+14 가 더 높지만, 그 우위는 '터치=체결' 가정에 의존한다 — 분봉 실측상 +14% 3차완결이 절반만 실현(고가 스침≠지정가 체결)돼 두 규칙이 사실상 동률. +7% 는 확실히 체결돼 실현 가능성이 높아 채택. 분할 비중은 분봉 실측상 프론트로딩(33/33/33)이 10/10/80보다 미세 우위(일봉 열세는 +7 낙관 착시)." },
  { t: "손절", d: "분할매도 한 단계가 체결되면 그 단계가를 손절가로 상향(예: +3% 매도 후 손절가 +3% → 최소 +3% 확정). 갭하락 시엔 그 시가로 체결. 2차 매수 후엔 신저가 손절 — 진입 이후 누적 최저가(진입가 및 매일의 저가 중 최소)를 하향하면 그 종가에 청산." },
  { t: "손절 무장 타이밍", d: "갭하락을 반영한 분봉 실측 결과 '즉시~단시간 무장'이 최적이다. 유예를 길게 둘수록 다음날 갭하락을 더 맞아 손실이 커진다(180분·240분이 즉시보다 열위). 단 무손절은 최악 — 손절은 반드시 걸되 빨리 건다. ※ 손절선은 매도가에 붙임(본전·한단계뒤 사다리는 되밀림 반납이 갭회피 이득보다 커 열위)." },
  { t: "기간 손절", d: "1차 매수 후 15영업일(약 3주) 안에 분할매도 1차(+3%)도 못 찍으면 그 종가에 강제 청산. 화석 포지션 누적 차단 + 자본 회전 ↑. MDD 개선의 주역(−33.8% → −12.0%)." },
  { t: "주문 실무", d: "1차 매수=마감 동시호가에 지지선 지정가. 2·3차 매수=직전매수가×0.93 감시주문. 매도·손절=감시주문." },
  { t: "위험 관리", d: "레버리지 1.2배 상한(초과 매수 미실행). 낙주 필터와 함께 CAGR·Calmar를 유지하며 마진 부담을 낮춤. 기준자본 1억." },
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
          <li><b>11.9년(2014-08~2026-07, 비용 0.215% 적용 · 현재 운용값 = 3주 기간 손절·+3/+5/+7 분할매도(33/33/33)·−7% 추가매수·18%/9% 사이징·레버 1.2·낙주필터(ret5&lt;−30)·시초 매도·추가매수일 매도 보류·broker 충돌 시 3차 매수 skip)</b>:
            CAGR <b className="text-accent">11.92%</b> · MDD <b className="text-accent">−13.44%</b> ·
            Calmar <b className="text-accent">0.89</b> · 승률 84.2% <span className="text-muted">(2026-07-19 재측정)</span>.</li>
          <li className="text-muted">분할매도 +3/+5/+7 + drop −10% + size 15/7.5 + 기간손절 없음 (2026-07-17 이전 운용값): CAGR 4.59% · MDD −33.8% · Calmar 0.14. → 개선의 주역은 기간손절·−7%·18/9(매도목표 아님).</li>
          <li><b>참고 — 7.2년(2019-03~) 부분 기간 (기간 손절 미적용)</b>: CAGR ~12% · MDD ~−11% · Calmar ~1.1. 2018·2020 큰 폭락 제외라 부풀어짐.</li>
          <li><b>12년 시점-정확(상폐 포함, 생존편향 제거, 옵션 B·기간 손절 미적용)</b>: CAGR ~9% · Calmar ~0.7 — quantBacktest 별도 결과.</li>
          <li className="text-muted">본 서비스 표시값은 무비용·0버퍼 모델(주문가 기준)로,
            실제 결과는 슬리피지·수수료·거래세·체결 현실성으로 더 낮을 수 있음.</li>
        </ul>
      </Section>

      <Section title="분봉 검증 (크레온 1·5분봉, 2026-07-17)">
        <p className="mb-2 text-sm text-muted">
          일봉 백테스트는 하루 안의 <b>순서</b>를 모른다(고가·저가 중 무엇이 먼저였는지).
          크레온 분봉으로 실제 장중 순서를 재생해 체결 가정을 검증했다.
          표본 2021-09~2026-07 · 230건(1분봉 149 + 5분봉 81). 2019~2020은 분봉 자체가 없어 미검증.
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          <li><b>매도당일 손절 가정 — 98.8% 타당</b>:
            <span className="text-muted"> 청산의 절반 이상이 &ldquo;매도한 그 날 손절&rdquo;로 끝나는데,
            분봉 재생 결과 유효 81건 중 80건에서 <b>매도 트리거 이후 실제로 손절가를 이탈</b>했다.
            일봉이 잘못 손절시킨 건 1건(1.2%).</span></li>
          <li><b>손절 유예 — 갭 반영 시 &ldquo;빨리 끊기&rdquo;가 최적</b>:
            <span className="text-muted"> 갭하락 손절(이탈 봉 시가로 체결)을 반영한 분봉 재생(313건)에서 즉시 무장이 최적이고
            유예를 길게 둘수록 다음날 갭하락을 더 맞아 손실이 커진다(180·240분이 즉시보다 열위).
            단 무손절은 최악 — 손절은 반드시 걸되 빨리 건다. 손절선은 매도가에 붙임(사다리는 되밀림 반납이 커 열위).</span></li>
          <li><b>신저가 손절 — 탐지 누락 0건, 종가 청산이 최적</b>:
            <span className="text-muted"> 신저가 이탈 시각이 대부분 09시대(중앙 09:15) — 15:10 스냅샷으로 전부 포착 가능.
            이탈 즉시 청산보다 <b>종가까지 기다리는 게 평균 +2.19% 유리</b>(신저가 깨고 그날 안에 반등이 많음).</span></li>
          <li><b>지정가 체결의 두 얼굴</b>:
            <span className="text-muted"> 목표가를 뚫는 폭이 중앙 0.97%로 <b>대부분은 확실히 체결</b>되나,
            +14% 같은 먼 목표는 고가로 스칠 뿐 미체결되는 경우가 상당수 — 이것이 +2/+6/+14 를 기각한 이유(위 표).</span></li>
          <li className="text-muted">⚠ 한계: 표본이 최근에 쏠림. 2014~2020(전체의 25%)은 분봉 부재로 영구 미검증. 하루단위 재생이라 절대값보다 상대비교가 유효.</li>
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
                <td className="py-1"><b>+3/+5/+7 · −7% · 18/9 · 기간손절 3주</b> <span className="text-muted">(현재)</span></td>
                <td className="py-1 text-right"><b className="text-accent">11.15%</b></td>
                <td className="py-1 text-right"><b className="text-accent">−12.0%</b></td>
                <td className="py-1 text-right"><b className="text-accent">0.93</b></td>
                <td className="py-1 text-right">84.8%</td>
              </tr>
              <tr className="border-t border-[var(--color-borderc)]">
                <td className="py-1 text-muted">+2/+6/+14 · −7% · 18/9 · 기간손절 (일봉상 최고이나 기각)</td>
                <td className="py-1 text-right">16.05%</td>
                <td className="py-1 text-right">−11.6%</td>
                <td className="py-1 text-right">1.39</td>
                <td className="py-1 text-right">89.1%</td>
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
          <li><b>개선의 주역은 매도목표가 아니라 기간손절·−7%·18/9</b>: 옛 설정 대비 CAGR 4.59→11.15%,
            MDD −33.8→−12.0%.
            <span className="text-muted"> 기간손절이 MDD를 낮추는 핵심 — 화석 포지션을 끊어 자본을 회전(발동은 소수지만 그 경로 자체를 차단).</span></li>
          <li><b>왜 +2/+6/+14 를 안 쓰나</b> — 일봉상 16.05% 로 더 높지만 <b>그 우위는 &ldquo;터치=체결&rdquo; 가정에 의존</b>:
            <span className="text-muted"> 전 보유기간 분봉 재생(갭하락 손절 반영)에서 두 규칙은 사실상 동률(+0.21%p).
            +14% 3차완결이 분봉에선 절반만 실현된다 — 고가로 스쳐도 지정가 뒤에 줄 서 미체결되는 경우가 많음.
            +7% 는 확실히 뚫어 체결돼 <b>실현 가능성이 높다</b>. → 실현성 우위로 +3/+5/+7 채택.</span></li>
          <li className="text-muted">⚠ 위 CAGR 은 12년 전체 기간 측정이라 표본내 편향이 남는다. 진정한 OOS 는 미래 데이터뿐.
            자본제약 포함 전기간 분봉 재생(최종 실현성)은 미완.</li>
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
          <li>• <b>손절은 장중 이벤트라 저녁 감시주문만으론 못 따라감.</b> 손절가는 매도가 위에 있어
            &ldquo;+2% 체결 이후&rdquo;에만 무장 가능한데, 감시주문은 전날 저녁에 세팅된다 →
            매도 당일 손절은 <b>장중 자동화(체결 감지 → 유예 후 스탑)가 있어야 집행</b>된다.
            자동화 없이 EOD 감시주문만 쓰면 실성과는 위 백테스트에 크게 못 미친다.</li>
          <li>• 모델 포트폴리오를 KRX 시세로 추적하며, 사용자 증권계좌와 연동되지 않음.</li>
          <li>• 자본 규모가 커지면 거래대금 대비 슬리피지·체결 현실성 한계가 커짐.</li>
          <li>• <b>자본의 약 90%가 놀고 있음</b> — 주식비중 평균 9~10%, 28%의 날은 무포지션,
            동시보유 평균 1.05종목. 위 CAGR 은 1억 전액이 아니라 평균 900~1,000만원이 일해서 낸 결과.</li>
        </ul>
      </Section>
    </>
  );
}
