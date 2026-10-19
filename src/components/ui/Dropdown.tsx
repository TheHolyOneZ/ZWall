import { ChevronDown } from "lucide-react";
import { useRef } from "react";
import { useStore } from "../../lib/store";

export function Dropdown<T extends string | number>({ value, options, onChange, label, width = 130 }: { value: T; options: [T, string][]; onChange(v: T): void; label?: string; width?: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find(([v]) => v === value)?.[1] ?? String(value);
  const open = () => {
    const r = ref.current!.getBoundingClientRect();
    useStore.getState().openMenu(
      r.left,
      r.bottom + 4,
      options.map(([v, text]) => ({ label: text, checked: v === value, onSelect: () => onChange(v) })),
    );
  };
  return (
    <button
      ref={ref}
      aria-label={label}
      aria-haspopup="menu"
      className="inline-flex items-center justify-between gap-2 h-[30px] px-2.5 rounded-[7px] text-[12px] transition-colors hover:bg-[var(--e2)]"
      style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)", minWidth: width }}
      onClick={open}
      onKeyDown={(e) => (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
    >
      <span className="truncate">{current}</span>
      <ChevronDown size={13} style={{ color: "var(--text-3)" }} />
    </button>
  );
}
