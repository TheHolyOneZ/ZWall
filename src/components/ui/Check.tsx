

import { Check as Tick, Minus } from "lucide-react";

export function Check({ on, mixed, disabled, label, onChange }: { on: boolean; mixed?: boolean; disabled?: boolean; label: string; onChange(v: boolean): void }) {
  const filled = on || mixed;
  return (
    <button
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={label}
      disabled={disabled}
      className="w-[16px] h-[16px] rounded-[5px] grid place-items-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ background: filled ? "var(--accent)" : "transparent", boxShadow: filled ? "none" : "inset 0 0 0 1.5px var(--text-4)", color: "var(--accent-ink)" }}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    >
      {mixed ? <Minus size={11} strokeWidth={3} /> : on ? <Tick size={11} strokeWidth={3} /> : null}
    </button>
  );
}
