

import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";
import { Heart } from "lucide-react";
import { useRef, useState } from "react";
import { describeTarget, place } from "../lib/actions";
import { KIND_LABEL } from "../lib/presets";
import { useStore, useThumb } from "../lib/store";
import { hitTest } from "../lib/targets";
import type { Wallpaper } from "../lib/types";
import { LookLayer, Preview } from "./Preview";
import { wallpaperMenu } from "../lib/menus";
import { contextMenu } from "./ui/Menu";

const DRAG_THRESHOLD = 5;

export function Card({ w, index, active }: { w: Wallpaper; index: number; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const px = useSpring(mx, { stiffness: 300, damping: 30 });
  const py = useSpring(my, { stiffness: 300, damping: 30 });
  const rotateY = useTransform(px, (v) => v * 9);
  const rotateX = useTransform(py, (v) => v * -7);
  const shineX = useTransform(px, (v) => 50 + v * 40);
  const shineY = useTransform(py, (v) => 50 + v * 40);
  const sheen = useMotionTemplate`radial-gradient(60% 60% at ${shineX}% ${shineY}%, rgba(255,255,255,.35), transparent 70%)`;
  const carrying = useStore((s) => s.carry?.wallpaper.id === w.id);
  const [hovered, setHovered] = useState(false);
  const thumb = useThumb(w);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const { setCarry, inspect } = useStore.getState();

    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      dragging = true;
      setCarry({ wallpaper: w, x: ev.clientX, y: ev.clientY, target: hitTest(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragging) return inspect(w.id);
      const target = hitTest(ev.clientX, ev.clientY);
      setCarry(null);
      if (target) {
        place(w, target);
        useStore.getState().toast("ok", `${w.name} · ${describeTarget(target).replace("Play on", "now on").replace("Span across", "spanning")}`);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <motion.div
      layout
      className="shrink-0"
      style={{ perspective: 700 }}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: carrying ? 0.25 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 300, damping: 30, delay: index < 14 ? 0.35 + index * 0.04 : 0 }}
    >
      <motion.div
        ref={ref}
        tabIndex={0}
        className={`card focusable${w.developing ? " developing" : ""}`}
        style={{ width: 208, height: 124, rotateX, rotateY, boxShadow: active ? "0 0 0 1.5px var(--accent)" : undefined }}
        whileHover={{ y: -4, scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onPointerMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
          my.set(((e.clientY - r.top) / r.height) * 2 - 1);
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => (mx.set(0), my.set(0), setHovered(false))}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => contextMenu(e, wallpaperMenu([w]))}
        onKeyDown={(e) => {

          if (e.key === "Enter" || e.key === " ") (e.preventDefault(), useStore.getState().inspect(w.id));
        }}
      >
        <LookLayer path={w.path}>
          <Preview look={w.look} src={thumb} px={px} py={py} />
        </LookLayer>

        <motion.div className="sheen" style={{ background: sheen }} animate={{ opacity: hovered ? 1 : 0 }} transition={{ duration: 0.18 }} />
        <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-6" style={{ background: "linear-gradient(transparent, rgba(0,0,0,.65))" }}>
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium leading-[1.3] truncate">{w.name}</div>
              <div className="text-[11px] leading-[1.3]" style={{ color: "var(--text-2)" }}>
                {w.developing ? "Developing…" : KIND_LABEL[w.kind]}
              </div>
            </div>
            {w.fav && <Heart size={12} fill="currentColor" style={{ color: "var(--err)" }} />}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
