import Link from "next/link";
import { Section } from "@/components/ui";

export const revalidate = 3600;

export const metadata = {
  title: "규칙 — 마감지기",
  description: "마감지기에서 추적하는 두 가지 트레이딩 시스템의 규칙.",
};

const SYSTEMS = [
  {
    href: "/rules/s2",
    title: "S2 (한국 평균회귀)",
    desc: "주도주 급락 눌림목 매매. 60일 내 거래대금 스파이크 종목이 20일선 −20% 이탈할 때 동시호가 지정가 진입, 분할매도 120일선 아래 +3/+5/+7% · 위 +3/+6.5/+10%, 거래대금 리셋·신저가 손절. 11.8년 검증 Calmar ~0.18, MDD −31%.",
  },
  {
    href: "/rules/rs96",
    title: "RS96+ (한미 추세추종)",
    desc: "O'Neil CANSLIM · Minervini SEPA 변형. 주간 상대강도 96 이상(상위 4%) 종목을 시장별 시총 필터와 함께 추적. 매수·매도 시점은 사용자가 차트로 직접 확인.",
  },
];

export default function RulesIndex() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">규칙</h1>
      <p className="mb-4 text-xs text-muted">
        마감지기는 서로 다른 두 트레이딩 시스템을 추적합니다. 각각의 규칙·검증 성과·한계는 아래에서 확인하세요.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {SYSTEMS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-xl border border-[var(--color-borderc)] bg-surface p-4 transition hover:border-accent"
          >
            <div className="mb-1 font-bold text-accent">{s.title}</div>
            <div className="text-sm leading-relaxed text-muted">{s.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
