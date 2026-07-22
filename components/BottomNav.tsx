"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { IS_RS96 } from "@/lib/site";

const MARGINKI_TABS = [
  { href: "/", label: "오늘", match: (p: string) => p === "/" || p.startsWith("/day") },
  { href: "/dashboard", label: "대시보드", match: (p: string) => p.startsWith("/dashboard") },
  { href: "/stocks", label: "종목", match: (p: string) => p.startsWith("/stocks") || p.startsWith("/trades") },
  { href: "/rules", label: "규칙", match: (p: string) => p.startsWith("/rules") },
];

const RS96_TABS = [
  { href: "/rs96?market=KR", label: "한국", match: (p: string) => p === "/rs96" || p.startsWith("/rs96/KR") },
  { href: "/rs96?market=US", label: "미국", match: (p: string) => p.startsWith("/rs96/US") },
  { href: "/rs96?market=JP", label: "일본", match: (p: string) => p.startsWith("/rs96/JP") },
  { href: "/global",         label: "테마", match: (p: string) => p.startsWith("/global") },
  { href: "/rs/search",      label: "조회", match: (p: string) => p.startsWith("/rs/search") },
  { href: "/performance",    label: "성과(KR)", match: (p: string) => p.startsWith("/performance") },
  { href: "/jp-backtest",    label: "성과(JP)", match: (p: string) => p.startsWith("/jp-backtest") },
  { href: "/rules/rs96",     label: "규칙", match: (p: string) => p.startsWith("/rules") },
];

export default function BottomNav() {
  const p = usePathname();
  const TABS = IS_RS96 ? RS96_TABS : MARGINKI_TABS;
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-10 border-t border-[var(--color-borderc)] bg-bg lg:hidden">
      <div className="mx-auto flex max-w-3xl">
        {TABS.map((t) => {
          const active = t.match(p);
          return (
            <Link key={t.href} href={t.href}
              className={`flex-1 py-3 text-center text-sm ${active ? "font-bold text-accent" : "text-muted"}`}>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
