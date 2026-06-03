"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";

const TABS = [
  { href: "/", label: "오늘", match: (p: string) => p === "/" || p.startsWith("/day") },
  { href: "/dashboard", label: "대시보드", match: (p: string) => p.startsWith("/dashboard") },
  { href: "/stocks", label: "종목", match: (p: string) => p.startsWith("/stocks") || p.startsWith("/trades") },
  { href: "/rs96", label: "RS96+", match: (p: string) => p.startsWith("/rs96") },
  { href: "/rules", label: "규칙", match: (p: string) => p.startsWith("/rules") },
];

export default function BottomNav() {
  const p = usePathname();
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
