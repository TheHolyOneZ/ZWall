import { AnimatePresence, motion } from "motion/react";
import { Eye } from "lucide-react";
import { endTrial, keepTrial } from "../lib/trial";
import { useStore } from "../lib/store";

export function TrialBar() {
  const trial = useStore((s) => s.trial);
  return (
    <AnimatePresence>
      {trial && (
        <motion.div
          className="glass-3 fixed left-1/2 bottom-5 -translate-x-1/2 flex items-center gap-3 rounded-[12px] pl-3.5 pr-1.5 py-1.5 text-[13px]"
          style={{ zIndex: 65 }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <Eye size={14} style={{ color: "var(--text-2)" }} />
          <span>
            Trying <b className="font-semibold">{trial.name}</b> on {trial.monitor}
          </span>
          <span className="text-[12px]" style={{ color: "var(--text-3)" }}>tweak it in the panel, then</span>
          <button className="btn btn-primary !h-[28px]" onClick={keepTrial}>Keep it</button>
          <button className="tbtn" onClick={endTrial}>Go back</button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
