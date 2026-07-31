"use client";
import { useEffect, useState } from "react";

// 접이식 규칙 설명 — 데스크톱(lg+)은 펼친 상태로 시작(상세 유지),
// 모바일은 접힌 상태로 시작해 데이터를 밀지 않음. 어느 쪽이든 사용자가 토글 가능.
// 네이티브 <details> 라 JS 없이도 열고 닫히며, open 초기값만 화면폭으로 정한다.
export default function RulesDisclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false); // SSR·모바일 기본 접힘 (하이드레이션 일치)
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setOpen(true); // 데스크톱은 펼침
  }, []);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="mb-5 rounded-xl border border-[var(--color-borderc)] bg-surface"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-bold marker:hidden">
        <span>{title}</span>
        <span className="shrink-0 text-xs font-normal text-muted">
          {open ? "접기 ▴" : "자세히 ▾"}
        </span>
      </summary>
      <div className="border-t border-[var(--color-borderc)] p-3">{children}</div>
    </details>
  );
}
