

import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useRef, useState } from "react";

export function Tip({ label, children, side = "bottom" }: { label: string; children: ReactNode; side?: "bottom" | "top" }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const show = () => (timer.current = window.setTimeout(() => setOpen(true), 400));
  const hide = () => (clearTimeout(timer.current), setOpen(false));
  return (
    <span className="relative inline-flex" onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide}>
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            className="glass-3 absolute left-1/2 z-50 whitespace-nowrap rounded-[8px] px-2 py-1 text-[11px] font-medium pointer-events-none"
            style={{ [side === "bottom" ? "top" : "bottom"]: "calc(100% + 8px)", translateX: "-50%", color: "var(--text)", maxWidth: 280 }}
            initial={{ opacity: 0, y: side === "bottom" ? -4 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18 }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
