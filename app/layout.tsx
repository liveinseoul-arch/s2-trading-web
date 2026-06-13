import type { Metadata } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import TopNav from "@/components/TopNav";
import CapitalInput from "@/components/CapitalInput";
import { CONFIG, IS_RS96 } from "@/lib/site";

const SITE_URL = IS_RS96
  ? "https://rs96.vercel.app"
  : "https://s2-trading-web.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: CONFIG.title,
  description: CONFIG.description,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: CONFIG.title,
    title: CONFIG.title,
    description: CONFIG.description,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: CONFIG.title,
    description: CONFIG.description,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="sticky top-0 z-10 border-b border-[var(--color-borderc)] bg-bg/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-3">
            <a href={CONFIG.homePath} className="font-bold tracking-tight">
              <span className="text-accent">{CONFIG.brandPrefix}</span>
              {CONFIG.brandSuffix}
            </a>
            <TopNav />
            {!IS_RS96 && <CapitalInput />}
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-4 lg:py-6">{children}</main>

        <footer className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted">
          ⚠ 본 서비스는 투자 정보·교육 목적이며 투자 권유·자문이 아닙니다. 모든 수치는 기준 모델
          포트폴리오의 시뮬레이션 결과이고, 과거 성과는 미래를 보장하지 않습니다. 실제 매매·손익
          책임은 이용자 본인에게 있습니다.
        </footer>

        <BottomNav />
      </body>
    </html>
  );
}
