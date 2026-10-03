

import { motion } from "motion/react";

export function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange(v: boolean): void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className="relative shrink-0 w-[34px] h-[20px] rounded-[7px] focusable transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ background: on ? "var(--accent)" : "var(--e3)" }}
      onClick={(e) => {
        e.preventDefault();
        onChange(!on);
      }}
    >
      <motion.span
        className="absolute top-[3px] left-[3px] w-[14px] h-[14px] rounded-[5px]"
        style={{ background: on ? "var(--accent-ink)" : "var(--text-2)" }}
        animate={{ x: on ? 14 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
      />
    </button>
  );
}
