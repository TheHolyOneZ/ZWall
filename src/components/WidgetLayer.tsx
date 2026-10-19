import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Widget } from "../lib/types";
import * as W from "../lib/widgets";

export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: number;
    const tick = () => {
      setNow(new Date());
      t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => clearTimeout(t);
  }, []);
  return now;
}

export function WidgetLayer({ monitor, interactive, zoom = 1 }: { monitor: string; interactive: boolean; zoom?: number }) {
  const all = useStore((s) => s.engine?.widgets);
  const accent = useStore((s) => s.engine?.accent ?? "#b35cff");
  const editing = useStore((s) => s.editingWidget);
  const mine = (all ?? []).filter((w) => w.monitor === monitor);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<Widget | null>(null);
  const now = useNow();
  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const els = useRef(new Map<string, HTMLElement>());

  const grab = (w: Widget, e: React.PointerEvent, mode: "move" | "size") => {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    useStore.getState().editWidget(w.id);
    const r = box.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, wx: w.x, wy: w.y, size: w.size };

    const own = els.current.get(w.id)?.getBoundingClientRect();
    const half = { w: (own?.width ?? 0) / 2, h: (own?.height ?? 0) / 2 };
    const others = mine
      .filter((o) => o.id !== w.id)
      .map((o) => els.current.get(o.id)?.getBoundingClientRect())
      .filter((b): b is DOMRect => !!b)
      .map((b) => ({ l: b.left - r.left, r: b.right - r.left, t: b.top - r.top, b: b.bottom - r.top, cx: (b.left + b.right) / 2 - r.left, cy: (b.top + b.bottom) / 2 - r.top }));
    const SNAP = 6;
    let cur = w;
    const move = (ev: PointerEvent) => {
      if (mode === "move") {
        let cx = (start.wx + (ev.clientX - start.x) / r.width) * r.width;
        let cy = (start.wy + (ev.clientY - start.y) / r.height) * r.height;
        const gx: number[] = [];
        const gy: number[] = [];
        if (!ev.altKey) {
          const xs: [number, number][] = [[r.width / 2, r.width / 2], [r.width / 3, r.width / 3], [(r.width * 2) / 3, (r.width * 2) / 3]];
          const ys: [number, number][] = [[r.height / 2, r.height / 2], [r.height / 3, r.height / 3], [(r.height * 2) / 3, (r.height * 2) / 3]];
          for (const o of others) {
            xs.push([o.cx, o.cx], [o.l, o.l + half.w], [o.r, o.r - half.w]);
            ys.push([o.cy, o.cy], [o.t, o.t + half.h], [o.b, o.b - half.h], [o.b, o.b + half.h], [o.t, o.t - half.h]);
          }
          const pick = (v: number, list: [number, number][]) => {
            let best: [number, number] | null = null;
            for (const c of list) if (Math.abs(c[1] - v) <= SNAP && (!best || Math.abs(c[1] - v) < Math.abs(best[1] - v))) best = c;
            return best;
          };
          const bx = pick(cx, xs);
          const by = pick(cy, ys);
          if (bx) (cx = bx[1]), gx.push(bx[0] / r.width);
          if (by) (cy = by[1]), gy.push(by[0] / r.height);
        }
        setGuides({ x: gx, y: gy });
        cur = { ...w, x: Math.max(0, Math.min(1, cx / r.width)), y: Math.max(0, Math.min(1, cy / r.height)) };
      } else {
        const grow = (ev.clientX - start.x + ev.clientY - start.y) / r.height;
        cur = { ...w, size: Math.max(0.015, Math.min(0.4, start.size + grow * 0.6)) };
      }
      setLive(cur);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({ x: [], y: [] });
      if (cur !== w) W.update(w.id, { x: cur.x, y: cur.y, size: cur.size });
      setTimeout(() => setLive(null), 300);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ pointerEvents: "none", zIndex: 2 }}>
      {guides.x.map((x) => (
        <span key={`gx${x}`} className="absolute top-0 bottom-0" style={{ width: 1 / zoom, left: `${x * 100}%`, background: "#ff5ab4", boxShadow: "0 0 4px rgba(255,90,180,.8)" }} />
      ))}
      {guides.y.map((y) => (
        <span key={`gy${y}`} className="absolute left-0 right-0" style={{ height: 1 / zoom, top: `${y * 100}%`, background: "#ff5ab4", boxShadow: "0 0 4px rgba(255,90,180,.8)" }} />
      ))}
      {size.h > 0 &&
        mine.map((base) => {
          const w = live?.id === base.id ? live : base;
          const color = w.color === "accent" ? accent : w.color;
          const px = Math.max(3, w.size * size.h);
          const selected = editing === w.id;
          return (
            <div
              key={w.id}
              ref={(el) => {
                if (el) els.current.set(w.id, el);
                else els.current.delete(w.id);
              }}
              className="absolute"
              style={{
                left: w.x * size.w,
                top: w.y * size.h,
                transform: "translate(-50%, -50%)",
                pointerEvents: interactive ? "auto" : "none",
                cursor: interactive ? "grab" : undefined,
                borderRadius: 4,
              }}
              onPointerDown={(e) => grab(w, e, "move")}
              onClick={(e) => e.stopPropagation()}
            >
              <WidgetFace w={w} color={color} px={px} now={now} />
              {selected && (
                <svg className="absolute pointer-events-none overflow-visible" style={{ left: -4 / zoom, top: -4 / zoom, width: `calc(100% + ${8 / zoom}px)`, height: `calc(100% + ${8 / zoom}px)` }}>
                  <rect x="0" y="0" width="100%" height="100%" rx={4 / zoom} fill="none" stroke="rgba(243,239,230,.75)" strokeWidth={1.5 / zoom} strokeDasharray={`${5 / zoom} ${4 / zoom}`} />
                </svg>
              )}
              {selected && interactive && (
                <span
                  className="absolute"
                  style={{ right: -9 / zoom, bottom: -9 / zoom, width: 10 / zoom, height: 10 / zoom, borderRadius: 3 / zoom, background: "#f3efe6", boxShadow: "0 1px 4px rgba(0,0,0,.5)", cursor: "nwse-resize" }}
                  onPointerDown={(e) => grab(w, e, "size")}
                />
              )}
            </div>
          );
        })}
    </div>
  );
}

export function WidgetFace({ w, color, px, now }: { w: Widget; color: string; px: number; now: Date }) {
  const effect = w.effect === "glow" ? `0 0 ${px * 0.25}px ${color}, 0 0 ${px * 0.08}px ${color}` : w.effect === "shadow" ? `0 ${Math.max(1, px * 0.04)}px ${px * 0.12}px rgba(0,0,0,.7)` : undefined;
  if (w.kind === "clock" && w.style === "analog") {
    const d = px * 2.6;
    const h = (now.getHours() % 12) + now.getMinutes() / 60;
    const m = now.getMinutes() + now.getSeconds() / 60;
    const hand = (turn: number, len: number, width: number) => {
      const a = turn * Math.PI * 2;
      return <line x1={-Math.sin(a) * 8} y1={Math.cos(a) * 8} x2={Math.sin(a) * len} y2={-Math.cos(a) * len} stroke={color} strokeWidth={width} strokeLinecap="round" />;
    };
    return (
      <svg width={d} height={d} viewBox="-100 -100 200 200" style={{ opacity: w.opacity, filter: w.effect === "glow" ? `drop-shadow(0 0 ${px * 0.15}px ${color})` : w.effect === "shadow" ? `drop-shadow(0 ${px * 0.04}px ${px * 0.08}px rgba(0,0,0,.7))` : undefined, display: "block" }}>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const inner = i % 3 === 0 ? 72 : 78;
          return <line key={i} x1={Math.sin(a) * 86} y1={-Math.cos(a) * 86} x2={Math.sin(a) * inner} y2={-Math.cos(a) * inner} stroke={color} strokeWidth={i % 3 === 0 ? 3.5 : 1.8} strokeLinecap="round" />;
        })}
        {hand(h / 12, 48, 6)}
        {hand(m / 60, 70, 4)}
        {w.seconds && hand(now.getSeconds() / 60, 78, 1.5)}
        <circle r={4.5} fill={color} />
      </svg>
    );
  }
  const big = w.kind === "clock" || w.kind === "battery";
  return (
    <div
      style={{
        color,
        opacity: w.opacity,
        fontFamily: w.font ? `"${w.font}"` : undefined,
        fontWeight: w.weight,
        fontSize: big ? px : px * 0.55,
        lineHeight: 1.1,
        letterSpacing: w.style === "minimal" ? `${-px * 0.02}px` : undefined,
        whiteSpace: "pre",
        textAlign: w.align,
        textShadow: effect,
        userSelect: "none",
      }}
    >
      {W.text(w, now)}
    </div>
  );
}
