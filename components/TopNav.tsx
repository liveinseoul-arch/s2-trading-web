"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { IS_RS96 } from "@/lib/site";

type Tab = { href: string; label: string; match: (p: string) => boolean };

// 마감지기: 왼편 RS96+ / 오른편 S2
const MARGINKI_LEFT: Tab[] = [
  { href: "/rs96",       label: "RS96+",       match: (p) => p.startsWith("/rs96") },
  { href: "/rules/rs96", label: "규칙(RS96+)", match: (p) => p === "/rules/rs96" },
];
const MARGINKI_RIGHT: Tab[] = [
  { href: "/",         label: "오늘",       match: (p) => p === "/" || p.startsWith("/day") },
  { href: "/dashboard",label: "대시보드",   match: (p) => p.startsWith("/dashboard") || p.startsWith("/month") },
  { href: "/stocks",   label: "종목",       match: (p) => p.startsWith("/stocks") || p.startsWith("/trades") },
  { href: "/rules/s2", label: "규칙(S2)",   match: (p) => p === "/rules/s2" || p === "/rules" },
];

// 선두지기(96+): 국가별 + 한미일 통합 테마 + 규칙
const RS96_TABS: Tab[] = [
  { href: "/rs96?market=KR", label: "한국", match: (p) => p === "/rs96" || p.startsWith("/rs96/KR") },
  { href: "/rs96?market=US", label: "미국", match: (p) => p.startsWith("/rs96/US") },
  { href: "/rs96?market=JP", label: "일본", match: (p) => p.startsWith("/rs96/JP") },
  { href: "/global",         label: "한미일 테마", match: (p) => p.startsWith("/global") },
  { href: "/rules/rs96",     label: "규칙", match: (p) => p === "/rules/rs96" || p === "/rules" },
];

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      className={active ? "font-medium text-accent" : "text-muted hover:text-textc"}
    >
      {tab.label}
    </Link>
  );
}

export default function TopNav() {
  const p = usePathname();

  if (IS_RS96) {
    return (
      <nav className="hidden items-center gap-5 text-sm lg:flex">
        {RS96_TABS.map((t) => <TabLink key={t.href} tab={t} active={t.match(p)} />)}
      </nav>
    );
  }

  return (
    <nav className="hidden items-center gap-5 text-sm lg:flex">
      {MARGINKI_LEFT.map((t) => <TabLink key={t.href} tab={t} active={t.match(p)} />)}
      <span aria-hidden className="mx-1 h-5 w-px bg-[var(--color-borderc)]" />
      {MARGINKI_RIGHT.map((t) => <TabLink key={t.href} tab={t} active={t.match(p)} />)}
    </nav>
  );
}
