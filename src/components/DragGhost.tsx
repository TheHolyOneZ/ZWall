import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, useVelocity } from "motion/react";
import { useEffect } from "react";
import { describeTarget } from "../lib/actions";
import { useStore, useThumb } from "../lib/store";
import { Preview } from "./Preview";

export function DragGhost() {
  const carry = useStore((s) => s.carry);
  const thumb = useThumb(carry?.wallpaper);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 600, damping: 40 });
  const sy = useSpring(y, { stiffness: 600, damping: 40 });
  const vx = useVelocity(sx);
  const rotate = useTransform(vx, [-2000, 2000], [-12, 12], { clamp: true });

  useEffect(() => {
    if (!carry) return;
    x.set(carry.x);
    y.set(carry.y);
  }, [carry, x, y]);

  return (
    <AnimatePresence>
      {carry && (
        <motion.div
          className="fixed left-0 top-0 pointer-events-none"
          style={{ x: sx, y: sy, zIndex: 50 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          <motion.div
            className="card"
            style={{ width: 176, height: 99, marginLeft: -88, marginTop: -60, rotate, boxShadow: "0 30px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.12)" }}
            initial={{ scale: 0.8 }}
            animate={{ scale: carry.target ? 0.82 : 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          >
            <Preview look={carry.wallpaper.look} src={thumb} />
          </motion.div>
          <motion.div
            key={carry.target ?? "none"}
            className="glass-3 absolute whitespace-nowrap rounded-[8px] px-2 py-1 text-[11px] font-medium"
            style={{ left: -88, top: 48, color: carry.target ? "var(--text)" : "var(--text-2)" }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            {describeTarget(carry.target)}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
