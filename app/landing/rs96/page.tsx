import Link from "next/link";

export const revalidate = 3600;

export const metadata = {
  title: "선두지기(96+) — 한미일 모멘텀 상위 4%",
  description:
    "한국·미국·일본 3개 시장에서 상대강도(RS) 상위 4% 종목을 매주 정리. 한미일 통합 테마로 어떤 트렌드가 동시 가동되는지, 종목 클릭으로 주차별 RS 추이를 한눈에.",
};

const POINTS = [
  { t: "어떤 테마가 글로벌 동시 가동인지", d: "한 시장 단독이 아니라 한·미·일에서 같이 RS96+ 가 뜨는 테마 = 진짜 큰 흐름. 카드 하나로 3국 동시 확인." },
  { t: "리스트는 매주 자동 갱신", d: "주말마다 12·24·36·48주 가중 모멘텀으로 RS를 다시 계산. 상위 4%만 남깁니다. 직접 스크리닝 필요 없음." },
  { t: "RS 시계열로 추세 검증", d: "이번 주 RS96만 보는 게 아니라 그 종목의 지난 12주 RS 추이를 한눈에. 갓 진입인지 이미 분출 중인지 분간." },
];

const STEPS = [
  {
    n: "1",
    t: "국가별 화면에서 후보 찾기",
    d: "한국·미국·일본 탭 → 그 시장의 RS96+ 종목 리스트 + Gemini 가 분류한 테마. 시총 상위 컷·거래대금 컷 적용된 깨끗한 모집단.",
  },
  {
    n: "2",
    t: "한미일 테마로 큰 흐름 잡기",
    d: "상단 \"한미일 테마\" 메뉴 → 3국 동시 가동되는 테마(예: AI 인프라·원자력·방위산업)가 상단. 같은 테마의 KR/US/JP 종목이 한 카드에.",
  },
  {
    n: "3",
    t: "종목 클릭으로 RS 추이 확인",
    d: "어느 화면이든 종목 클릭 → 최근 26주 RS 막대 그래프. RS96+ 막대만 진하게 칠해져 \"언제 진입했고 얼마나 지속됐는지\" 한눈에.",
  },
];

const FAQ = [
  {
    q: "RS96이 뭔가요?",
    a: "IBD/Minervini 기준의 상대강도(Relative Strength) 백분위. 0~99 중 96 이상 = 같은 시장 종목 대비 모멘텀 상위 4%. CANSLIM·SEPA 류의 기본 진입 컷오프이고, 이 서비스에선 12·24·36·48주 가중 누적수익률로 산출합니다.",
  },
  {
    q: "어떤 종목이 모집단인가요?",
    a: "한국 = 시총 상위 40% AND 5,000억원 이상. 미국 = 시총 상위 20%. 일본 = 시총 상위 20% AND 1,500억엔 이상(Yahoo Japan + Google Finance 통합 99% 커버). 거래대금·유동성 문제 종목 자동 컷.",
  },
  {
    q: "매매 신호도 주나요?",
    a: "아니요. 후보 리스트와 RS 추이만 제공합니다. 매수·매도 시점은 본인이 차트로 직접 판단(CANSLIM·SEPA 룰 또는 본인 룰). 자동매매 아니며, 증권계좌와도 연동되지 않습니다.",
  },
  {
    q: "한미일 테마 통합은 어떻게 되나요?",
    a: "각 시장에서 Gemini가 분류한 테마명을 정규화 매핑으로 묶습니다(예: \"AI 인프라\" ≈ \"AI infrastructure\"). 분류 시점이 시장마다 미세하게 다를 수 있으니 같은 테마가 다른 이름으로 흩어질 가능성이 있고, 그건 카드 상단에 보이는 \"3국 동시\" 뱃지로 확인합니다.",
  },
  {
    q: "갱신 주기는?",
    a: "매주 토요일 자동 갱신. 직전 주 종가 기준으로 RS·테마 재계산 후 적재됩니다.",
  },
  {
    q: "정말 무료인가요?",
    a: "베타 기간 공개 무료입니다. 로그인 없이 누구나 볼 수 있고 별도 결제도 없습니다.",
  },
];

export default function Rs96Landing() {
  return (
    <div className="pb-16 pt-8 lg:pt-12">
      {/* Hero */}
      <section className="mb-20 sm:mb-28">
        <div className="max-w-3xl">
          <p className="mb-3 text-sm font-medium text-accent">한국 · 미국 · 일본 모멘텀</p>
          <h1 className="mb-6 text-3xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            상위 4% 만 보면 됩니다.<br />
            <span className="text-accent">3국 동시</span> 가동되는<br />
            테마는 더더욱.
          </h1>
          <p className="mb-8 text-base leading-relaxed text-muted sm:text-lg lg:text-xl">
            한국·미국·일본 3개 시장의 <b className="text-textc">RS 상위 4%(96~99) 종목</b>을 매주 자동 정리.
            국가별로도, <b className="text-textc">한미일 통합 테마</b>로도 한눈에 — 종목 클릭하면 26주 RS 추이까지.
          </p>
          <Link
            href="/global"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-base font-medium text-white shadow-sm transition hover:opacity-90 sm:text-lg"
          >
            한미일 테마 둘러보기 →
          </Link>
          <p className="mt-3 text-xs text-muted">베타 기간 공개 무료 · 로그인 불필요</p>
        </div>
      </section>

      {/* 무엇을 보는가 */}
      <section className="mb-20 sm:mb-28">
        <h2 className="mb-8 text-xl font-bold sm:text-2xl">선두지기로 보는 것</h2>
        <ul className="grid gap-5 sm:grid-cols-3 sm:gap-6">
          {POINTS.map((x) => (
            <li key={x.t} className="rounded-lg border-l-2 border-accent bg-surface p-5">
              <p className="font-semibold">{x.t}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{x.d}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 어떻게 쓰는가 */}
      <section className="mb-20 sm:mb-28">
        <h2 className="mb-8 text-xl font-bold sm:text-2xl">이렇게 씁니다</h2>
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

      {/* FAQ */}
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
        <h2 className="mb-3 text-2xl font-bold sm:text-3xl lg:text-4xl">3국 동시 테마부터 보세요</h2>
        <p className="mx-auto mb-7 max-w-xl text-sm text-muted sm:text-base">
          한·미·일 RS96+ 가 한 화면에. 어떤 트렌드가 글로벌 동시 가동인지 즉시 확인.
        </p>
        <Link
          href="/global"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-base font-medium text-white shadow-sm transition hover:opacity-90 sm:text-lg"
        >
          한미일 테마 →
        </Link>
      </section>

      {/* Disclaimer */}
      <section className="mb-12 rounded-lg border border-[var(--color-borderc)] bg-surface p-4 text-xs leading-relaxed text-muted sm:p-5">
        ⚠ 본 서비스는 투자 정보·교육 목적이며 투자 권유·자문이 아닙니다. RS 등급은 과거 가격 데이터 기반의 통계이며,
        미래 수익을 보장하지 않습니다. 실제 매수·매도·손익 책임은 전적으로 이용자 본인에게 있습니다.
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-borderc)] pt-6 text-sm text-muted">
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
          <a href="mailto:liveinseoul@gmail.com" className="hover:text-accent">
            문의: liveinseoul@gmail.com
          </a>
          <Link href="/rules/rs96" className="hover:text-accent">RS96+ 규칙</Link>
        </div>
        <p className="text-xs">© 2026 선두지기(96+) · 베타 기간 무료</p>
      </footer>
    </div>
  );
}
