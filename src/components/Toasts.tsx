
import { AnimatePresence, motion } from "motion/react";
import { Check, TriangleAlert } from "lucide-react";
import { useStore } from "../lib/store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="fixed top-[56px] right-4 flex flex-col items-end gap-2 pointer-events-none" style={{ zIndex: 60 }}>
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="glass-3 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px]"
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
          >
            {t.kind === "ok" ? <Check size={14} style={{ color: "var(--text-2)" }} /> : <TriangleAlert size={14} style={{ color: "var(--err)" }} />}
            {t.text}
            {t.action && (
              <button
                className="pointer-events-auto ml-2 -mr-1 h-[24px] px-2 rounded-[6px] text-[12px] font-semibold transition-colors hover:bg-[var(--e3)]"
                style={{ color: "var(--text)" }}
                onClick={() => {
                  t.action!.run();
                  useStore.getState().dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
