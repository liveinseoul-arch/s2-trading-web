import Link from "next/link";
import { redirect } from "next/navigation";
import { IS_RS96 } from "@/lib/site";

export const revalidate = 3600;

export const metadata = {
  title: "마감지기 — 룰은 당신이, 감시는 우리가",
  description:
    "검증된 매매 룰은 갖춘 직장인 투자자를 위해 — 장중 시세 감시는 시스템이 대신합니다. 15:10 동시호가 직전엔 오늘 살 종목과 지지선 지정가를, 15:45 마감 직후엔 체결 결과와 내일 세팅할 감시주문을 정확히 전달합니다.",
};

const POINTS = [
  { t: "자기 룰은 이미 완성된 분", d: "검증·문서화까지 마친 매매 시스템이 있고, 그대로만 따라가면 된다고 확신한다." },
  { t: "장중에 시세를 못 보는 분", d: "평일 9시~15시 30분은 직장 업무라 차트·종가를 들여다볼 시간이 없다." },
  { t: "기회를 놓쳐본 분", d: "룰이 발동했는데 모르고 지나간 후회가 한 번이라도 있다 — 그게 가장 비싼 비용이라는 걸 안다." },
];

const STEPS = [
  {
    n: "1",
    t: "모델이 매일 KRX 시세를 자동 감시",
    d: "검증된 S2 룰(11.8년 백테스트 Calmar ~1.00, 비용 적용, +2/+6/+14 분할매도·3주 기간 손절·시초 매도·추가매수일 매도 보류·broker 충돌 시 3차 매수 skip)을 시세에 적용해 모델 포트폴리오를 추적합니다. 직장에서 일하는 동안 시스템이 대신 봅니다.",
  },
  {
    n: "2",
    t: "15:10 — 동시호가 직전 알림",
    d: "오늘 살 종목·지지선 지정가·포트%를 텔레그램과 웹으로 전달. 마감 동시호가(15:20~15:30)에 지정가만 미리 걸어두면 끝.",
  },
  {
    n: "3",
    t: "15:45 — 마감 결과 + 내일 감시주문 플랜",
    d: "오늘 실제 체결된 매수·매도와, 내일 걸어둘 매수/매도/손절 감시주문 가격을 함께 발송. 저녁에 5분만 갱신하면 됩니다.",
  },
];

const METRICS = [
  { k: "11.8년 CAGR", v: "11.2%" },
  { k: "MDD", v: "−11.3%" },
  { k: "승률", v: "90%" },
];

const OUTCOMES = [
  { t: "매일 9~15시 고민 0", d: "\"오늘 뭘 사지?\"를 종일 들여다볼 필요가 사라집니다." },
  { t: "기회 놓치는 후회 0", d: "룰이 발동했는데 모르고 지나가는 일이 없습니다." },
  { t: "운영 시간 하루 10분", d: "동시호가 지정가 주문만 미리 걸어두면 끝입니다." },
];

const FAQ = [
  {
    q: "실제 매매도 대신 해주나요?",
    a: `아니요. 모델 포트폴리오를 KRX 시세로 추적해 "지금 이 주문을 거세요"라고 알려드릴 뿐, 사용자 증권계좌와는 연동되지 않습니다. 실제 주문 입력·체결은 본인이 브로커에서 직접 합니다(자동매매 아님).`,
  },
  {
    q: "어떤 매매 시스템인가요?",
    a: "S2(주도주 급락 눌림목 매매) — 일정 거래대금 이상 종목이 20일선 −20%(Envelope)를 이탈할 때 동시호가 지정가 진입, 분할매도 +3/+5/+7%, 거래대금 리셋·신저가 손절. 11.8년(2014-08~) 백테스트로 검증 완료입니다 — 2018·2020 큰 폭락 포함, 시초 매도·추가매수일 매도 보류 보수적 가정(규칙 화면에 상세 공개).",
  },
  {
    q: "내 자본과 모델 자본이 달라요. 수량은 어떻게 정하나요?",
    a: "모든 사이즈는 포트%(15/12/7.5/6) 기준으로 안내합니다. 자기 자본에 곱해 주문 금액을 정하면 됩니다. 웹 헤더에 자본을 입력하면 자동으로 예상 주문 수량을 환산해 보여드립니다.",
  },
  {
    q: "한국 주식만 다루나요?",
    a: "네, 현재 한국 주식(KOSPI·KOSDAQ) 전용입니다. 미국 시장은 별도 검증 결과 대형주에선 유의미한 엣지가 없어, S2 룰의 강점이 살아나는 한국 시장에 집중합니다.",
  },
  {
    q: "정말 무료인가요?",
    a: "베타 기간 동안 공개 무료입니다. 로그인 없이 누구나 볼 수 있고 별도 결제도 없습니다.",
  },
];

export default function Landing() {
  if (IS_RS96) redirect("/landing/rs96");
  return (
    <div className="pb-16 pt-8 lg:pt-12">
      {/* Hero */}
      <section className="mb-20 sm:mb-28">
        <div className="max-w-3xl">
          <p className="mb-3 text-sm font-medium text-accent">한국 주식 · S2 매매 시스템</p>
          <h1 className="mb-6 text-3xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            룰은 다 만들어놨는데,<br />
            장중에 발동을 못 보면<br />
            <span className="text-accent">무용지물</span>이죠.
          </h1>
          <p className="mb-8 text-base leading-relaxed text-muted sm:text-lg lg:text-xl">
            직장 다니는 동안 시세 감시는 시스템이 대신합니다.
            <b className="text-textc"> 동시호가 직전</b>과
            <b className="text-textc"> 마감 직후</b>, 어떤 종목을 어느 가격에 어느 비중으로 주문해야 하는지
            텔레그램·웹으로 알려드립니다.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-base font-medium text-white shadow-sm transition hover:opacity-90 sm:text-lg"
          >
            무료로 둘러보기 →
          </Link>
          <p className="mt-3 text-xs text-muted">베타 기간 공개 무료 · 로그인 불필요</p>
        </div>
      </section>

      {/* 이런 분에게 — PC 3열 / 모바일 세로 */}
      <section className="mb-20 sm:mb-28">
        <h2 className="mb-8 text-xl font-bold sm:text-2xl">이런 분에게</h2>
        <ul className="grid gap-5 sm:grid-cols-3 sm:gap-6">
          {POINTS.map((x) => (
            <li key={x.t} className="rounded-lg border-l-2 border-accent bg-surface p-5">
              <p className="font-semibold">{x.t}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{x.d}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 이렇게 동작해요 — PC 3열 카드 */}
      <section className="mb-20 sm:mb-28">
        <h2 className="mb-8 text-xl font-bold sm:text-2xl">이렇게 동작해요</h2>
        <ol className="grid gap-5 sm:grid-cols-3 sm:gap-6">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-lg border border-[var(--color-borderc)] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-base font-bold text-white">
                {s.n}
              </div>
              <p className="font-semibold">{s.t}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 이런 결과 — 지표 카드 3 + 정성 결과 3 */}
      <section className="mb-20 sm:mb-28">
        <h2 className="mb-8 text-xl font-bold sm:text-2xl">이런 결과가 나와요</h2>
        <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
          {METRICS.map((x) => (
            <div key={x.k} className="rounded-lg border border-[var(--color-borderc)] p-5 text-center sm:p-6">
              <div className="text-xs text-muted sm:text-sm">{x.k}</div>
              <div className="mt-2 text-3xl font-bold text-accent tnum sm:text-4xl">{x.v}</div>
            </div>
          ))}
        </div>
        <p className="mb-8 text-xs leading-relaxed text-muted sm:text-sm">
          11.8년(2014-08~2026-06) 정직(무비용·0버퍼 · 시초 매도·추가매수일 매도 보류 가정) 기준. 단기 7년만 보면 CAGR 12% · Calmar 1.1 로 더 높지만, 장기 11.8년에는 2018·2020 큰 폭락 포함 MDD -31% · CAGR 5.7%. 별도 시점-정확(상폐 포함) 12년 Calmar ~0.7
          — 장기 정직 하한도 함께 공개합니다. 과거 성과는 미래를 보장하지 않습니다.
        </p>
        <ul className="grid gap-4 border-t border-[var(--color-borderc)] pt-8 sm:grid-cols-3 sm:gap-6">
          {OUTCOMES.map((o) => (
            <li key={o.t} className="flex gap-3">
              <span className="mt-0.5 font-bold text-accent">✓</span>
              <div>
                <p className="font-medium">{o.t}</p>
                <p className="mt-1 text-sm text-muted">{o.d}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ — 가독성 위해 좁게 유지 */}
      <section className="mb-20 sm:mb-28">
        <h2 className="mb-8 text-xl font-bold sm:text-2xl">자주 묻는 질문</h2>
        <div className="mx-auto flex max-w-3xl flex-col divide-y divide-[var(--color-borderc)] border-y border-[var(--color-borderc)]">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 font-medium marker:hidden">
                <span><span className="mr-1.5 text-accent">Q.</span>{f.q}</span>
                <span className="mt-0.5 text-muted transition-transform group-open:rotate-180">▾</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mb-12 rounded-2xl bg-surface p-8 text-center sm:mb-16 sm:p-12 lg:p-16">
        <h2 className="mb-3 text-2xl font-bold sm:text-3xl lg:text-4xl">먼저 한번 둘러보세요</h2>
        <p className="mx-auto mb-7 max-w-xl text-sm text-muted sm:text-base">
          오늘의 매수 후보·체결·보유·월별 성과를 로그인 없이 바로 확인할 수 있습니다.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-base font-medium text-white shadow-sm transition hover:opacity-90 sm:text-lg"
        >
          무료로 둘러보기 →
        </Link>
      </section>

      {/* Disclaimer */}
      <section className="mb-12 rounded-lg border border-[var(--color-borderc)] bg-surface p-4 text-xs leading-relaxed text-muted sm:p-5">
        ⚠ 본 서비스는 투자 정보·교육 목적이며 투자 권유·자문이 아닙니다. 모든 수치는 기준 모델
        포트폴리오(기준자본 1억원, 무비용·0버퍼 모델)의 시뮬레이션 결과이고, 과거 성과는 미래를
        보장하지 않습니다. 본 서비스는 사용자의 증권계좌와 연동되지 않으며, 실제 주문·체결·손익
        책임은 전적으로 이용자 본인에게 있습니다.
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-borderc)] pt-6 text-sm text-muted">
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
          <a href="mailto:liveinseoul@gmail.com" className="hover:text-accent">
            문의: liveinseoul@gmail.com
          </a>
          <Link href="/rules" className="hover:text-accent">매매 규칙</Link>
          <a href="#terms" className="hover:text-accent">이용약관</a>
          <a href="#refund" className="hover:text-accent">환불 정책</a>
        </div>
        <p className="text-xs">© 2026 S2 트레이딩 따라하기 · 베타 기간 무료(별도 결제 없음)</p>
      </footer>
    </div>
  );
}
