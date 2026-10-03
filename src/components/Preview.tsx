

import type { MotionValue } from "motion/react";
import { motion, motionValue, useTransform } from "motion/react";
import { useState, type ReactNode } from "react";
import { useStore } from "../lib/store";
import type { Look } from "../lib/types";


export function LookLayer({ path, children }: { path: string; children: ReactNode }) {
  const params = useStore((s) => s.engine?.params?.[path]);
  const accent = useStore((s) => s.engine?.accent ?? "#b35cff");
  const filters: string[] = [];
  if (params?.tint === "mono") filters.push("grayscale(1)");
  if (params && params.intensity !== 1) filters.push(`brightness(${(0.55 + 0.45 * params.intensity).toFixed(2)})`);
  return (
    <div className="absolute inset-0" style={{ filter: filters.join(" ") || undefined, transition: "filter .26s" }}>
      {children}
      {params?.tint === "accent" && <div className="absolute inset-0 pointer-events-none" style={{ background: accent, mixBlendMode: "color", opacity: 0.8 }} />}
    </div>
  );
}

const DEPTHS = [0.25, 0.6, 1] as const;
const ZERO = motionValue(0);

export function Preview({ look, src, px, py, paused, onLoad }: { look: Look; src?: string | null; px?: MotionValue<number>; py?: MotionValue<number>; paused?: boolean; onLoad?: () => void }) {
  if (src) return <Picture src={src} px={px} py={py} paused={paused} onLoad={onLoad} />;
  return (
    <div className={`preview look-${look}${paused ? " is-paused" : ""}`}>
      {DEPTHS.map((d, i) => (
        <Layer key={i} depth={d} index={i} px={px} py={py} />
      ))}
    </div>
  );
}

function Picture({ src, px, py, paused, onLoad }: { src: string; px?: MotionValue<number>; py?: MotionValue<number>; paused?: boolean; onLoad?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const x = useTransform(px ?? ZERO, (v) => v * -10);
  const y = useTransform(py ?? ZERO, (v) => v * -7);
  return (
    <div className={`preview${paused ? " is-paused" : ""}`}>
      {!loaded && <div className="absolute inset-0 shimmer" />}
      <motion.img
        src={src}
        alt=""
        draggable={false}
        className="picture"
        style={{ x, y }}
        initial={false}
        animate={{ opacity: loaded ? 1 : 0 }}
        transition={{ duration: 0.4 }}
        onLoad={() => (setLoaded(true), onLoad?.())}
      />
    </div>
  );
}

function Layer({ depth, index, px, py }: { depth: number; index: number; px?: MotionValue<number>; py?: MotionValue<number> }) {

  const x = useTransform(px ?? ZERO, (v) => v * 14 * depth);
  const y = useTransform(py ?? ZERO, (v) => v * 10 * depth);
  return <motion.div className={`layer l${index}`} style={{ x, y }} />;
}
