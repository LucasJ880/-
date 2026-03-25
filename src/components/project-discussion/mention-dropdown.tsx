"use client";

import { useEffect, useRef } from "react";
import type { DiscussionMember } from "./project-discussion-section";

interface Props {
  members: DiscussionMember[];
  query: string;
  activeIndex: number;
  onSelect: (member: DiscussionMember) => void;
  position: { top: number; left: number };
}

export function MentionDropdown({ members, query, activeIndex, onSelect, position }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
    : members;

  useEffect(() => {
    const activeEl = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute z-50 max-h-48 w-56 overflow-y-auto rounded-lg border border-border bg-card-bg shadow-lg"
      style={{ bottom: position.top, left: position.left }}
    >
      {filtered.map((m, i) => (
        <button
          key={m.userId}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(m);
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
            i === activeIndex ? "bg-accent/10 text-accent" : "text-foreground hover:bg-accent/5"
          }`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-medium text-accent overflow-hidden">
            {m.avatar ? (
              <img src={m.avatar} alt={m.name} className="h-full w-full object-cover" />
            ) : (
              m.name.slice(0, 1).toUpperCase()
            )}
          </span>
          <span className="truncate">{m.name}</span>
        </button>
      ))}
    </div>
  );
}
