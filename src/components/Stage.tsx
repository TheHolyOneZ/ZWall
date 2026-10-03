

import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import { Clock3, MonitorOff, Move, Power, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../lib/ipc";
import { send } from "../lib/actions";
import { onDesk, tolerance } from "../lib/desk";
import { Seams } from "./Seams";
import { WidgetLayer } from "./WidgetLayer";
import * as addWidget from "../lib/widgets";
import { byPath, resolve, useStore, useThumb } from "../lib/store";
import { registerTarget } from "../lib/targets";
import type { Monitor } from "../lib/types";
import { LookLayer, Preview } from "./Preview";
import { ScreenAutomations } from "./ScreenAutomations";
import { screenMenu } from "../lib/menus";
import { contextMenu } from "./ui/Menu";
import { clearScreen } from "../lib/undo";

const GAP = 22;
const PAD = 40;

interface Placed {
  m: Monitor;
  left: number;
  top: number;
  w: number;
  h: number;
}

interface Bridge {
  id: string;
  left: number;
  top: number;
  w: number;
  h: number;
  vertical: boolean;
}


function clampView(v: { s: number; x: number; y: number }, w: number, h: number) {
  return { s: v.s, x: Math.min(0, Math.max(w - w * v.s, v.x)), y: Math.min(0, Math.max(h - h * v.s, v.y)) };
}


interface Xform {
  s: number;
  offX: number;
  offY: number;
  minX: number;
  minY: number;
}

function fit(monitors: Monitor[], box: { w: number; h: number }): Xform {
  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const maxX = Math.max(...monitors.map((m) => m.x + m.width));
  const maxY = Math.max(...monitors.map((m) => m.y + m.height));
  const s = Math.min((box.w - PAD * 2) / (maxX - minX), (box.h - PAD * 2) / (maxY - minY));
  return { s, minX, minY, offX: (box.w - (maxX - minX) * s) / 2, offY: (box.h - (maxY - minY) * s) / 2 };
}

function layout(monitors: Monitor[], box: { w: number; h: number }, fixed?: Xform | null) {
  if (!monitors.length || box.w === 0) return { placed: [] as Placed[], bridges: [] as Bridge[], xf: null as Xform | null };
  const xf = fixed ?? fit(monitors, box);
  const { s, offX, offY, minX, minY } = xf;
  const placed = monitors.map((m) => ({
    m,
    left: offX + (m.x - minX) * s + GAP / 2,
    top: offY + (m.y - minY) * s + GAP / 2,
    w: m.width * s - GAP,
    h: m.height * s - GAP,
  }));
  const bridges: Bridge[] = [];
  for (const a of monitors)
    for (const b of monitors) {

      if (a.x < b.x && Math.abs(a.x + a.width - b.x) <= tolerance(Math.min(a.width, b.width))) {
        const top = Math.max(a.y, b.y), bottom = Math.min(a.y + a.height, b.y + b.height);
        if (bottom > top)
          bridges.push({ id: `span:${a.name}+${b.name}`, left: offX + (b.x - minX) * s - GAP / 2 - 6, top: offY + (top - minY) * s + GAP, w: GAP + 12, h: (bottom - top) * s - GAP * 2, vertical: true });
      }
      if (a.y < b.y && Math.abs(a.y + a.height - b.y) <= tolerance(Math.min(a.height, b.height))) {
        const left = Math.max(a.x, b.x), right = Math.min(a.x + a.width, b.x + b.width);
        if (right > left)
          bridges.push({ id: `span:${a.name}+${b.name}`, left: offX + (left - minX) * s + GAP, top: offY + (b.y - minY) * s - GAP / 2 - 6, w: (right - left) * s - GAP * 2, h: GAP + 12, vertical: false });
      }
    }
  return { placed, bridges, xf };
}


function spanCanvas(p: Placed, placed: Placed[]) {
  const group = p.m.span ? placed.filter((q) => q.m.span === p.m.span) : [p];
  const left = Math.min(...group.map((q) => q.left));
  const top = Math.min(...group.map((q) => q.top));
  const right = Math.max(...group.map((q) => q.left + q.w));
  const bottom = Math.max(...group.map((q) => q.top + q.h));
  return { left: left - p.left, top: top - p.top, width: right - left, height: bottom - top };
}

export function Stage() {
  const engine = useStore((s) => s.engine);
  const connected = useStore((s) => s.connected);
  const hydrated = useStore((s) => s.hydrated);
  const carry = useStore((s) => s.carry);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });


  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const px = useSpring(rawX, { stiffness: 120, damping: 20 });
  const py = useSpring(rawY, { stiffness: 120, damping: 20 });

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);


  const usable = box;


  const [frac, setFrac] = useState({ s: 1, fx: 0, fy: 0 });
  const view = { s: frac.s, x: frac.fx * box.w, y: frac.fy * box.h };
  const setView = (next: { s: number; x: number; y: number } | ((v: { s: number; x: number; y: number }) => { s: number; x: number; y: number })) =>
    setFrac((f) => {
      const cur = { s: f.s, x: f.fx * box.w, y: f.fy * box.h };
      const v = typeof next === "function" ? next(cur) : next;
      return { s: v.s, fx: box.w ? v.x / box.w : 0, fy: box.h ? v.y / box.h : 0 };
    });
  const [panning, setPanning] = useState(false);

  const [arranging, setArranging] = useState(false);
  const [moving, setMoving] = useState<{ name: string; pos: [number, number]; xf: Xform } | null>(null);
  const arrangement = engine?.arrangement;
  const desk = useMemo(() => (engine?.monitors ?? []).map((m) => (moving?.name === m.name ? { ...m, x: moving.pos[0], y: moving.pos[1] } : onDesk(m, arrangement))), [engine?.monitors, arrangement, moving]);
  const { placed, bridges, xf } = useMemo(() => layout(desk, usable, moving?.xf), [desk, usable, moving?.xf]);
  const startMove = (p: Placed, e: React.PointerEvent) => {
    if (!arranging || e.button !== 0 || !xf) return;
    e.preventDefault();
    const frozen = xf;
    const start = { x: e.clientX, y: e.clientY, mx: p.m.x, my: p.m.y };
    const others = desk.filter((o) => o.name !== p.m.name);
    const snap = 14 / (frozen.s * view.s);
    let pos: [number, number] = [p.m.x, p.m.y];
    const move = (ev: PointerEvent) => {
      let x = start.mx + (ev.clientX - start.x) / (frozen.s * view.s);
      let y = start.my + (ev.clientY - start.y) / (frozen.s * view.s);

      const xs = others.flatMap((o) => [o.x + o.width, o.x - p.m.width, o.x, o.x + o.width - p.m.width]);
      const ys = others.flatMap((o) => [o.y, o.y + o.height - p.m.height, o.y + (o.height - p.m.height) / 2, o.y + o.height, o.y - p.m.height]);
      const nx = xs.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), Infinity);
      const ny = ys.reduce((best, v) => (Math.abs(v - y) < Math.abs(best - y) ? v : best), Infinity);
      if (Math.abs(nx - x) <= snap) x = nx;
      if (Math.abs(ny - y) <= snap) y = ny;
      pos = [Math.round(x), Math.round(y)];
      setMoving({ name: p.m.name, pos, xf: frozen });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const all = Object.fromEntries(desk.map((m) => [m.name, [m.x, m.y] as [number, number]]));
      all[p.m.name] = pos;

      const minX = Math.min(...Object.values(all).map((v) => v[0]));
      const minY = Math.min(...Object.values(all).map((v) => v[1]));
      const sysX = Math.min(...(engine?.monitors ?? []).map((m) => m.x));
      const sysY = Math.min(...(engine?.monitors ?? []).map((m) => m.y));
      send({ SetArrangement: Object.fromEntries(Object.entries(all).map(([n, v]) => [n, [v[0] - minX + sysX, v[1] - minY + sysY] as [number, number]])) });
      setTimeout(() => setMoving(null), 60);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const customised = !!arrangement && Object.keys(arrangement).length > 0;
  const canBlend = engine?.backend === "plasma" || engine?.backend === "mock";

  return (
    <div
      ref={ref}
      className="relative flex-1 min-h-0"
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        rawX.set(((e.clientX - r.left) / r.width) * 2 - 1);
        rawY.set(((e.clientY - r.top) / r.height) * 2 - 1);
      }}
      onPointerLeave={() => (rawX.set(0), rawY.set(0))}
      onWheel={(e) => {
        const r = ref.current!.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        setView((v) => {
          const s = Math.max(1, Math.min(5, v.s * Math.exp(-e.deltaY * 0.0015)));
          if (s === 1) return { s: 1, x: 0, y: 0 };

          return clampView({ s, x: cx - ((cx - v.x) * s) / v.s, y: cy - ((cy - v.y) * s) / v.s }, r.width, r.height);
        });
      }}
      onPointerDown={(e) => {

        const empty = !(e.target as HTMLElement).closest(".bezel, button, [data-marker], .pointer-events-auto");
        if (!(e.button === 1 || (e.button === 0 && empty && view.s > 1))) return;
        e.preventDefault();
        const r = ref.current!.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, s: view.s };
        setPanning(true);
        const move = (ev: PointerEvent) => setView(clampView({ s: start.s, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }, r.width, r.height));
        const up = () => {
          setPanning(false);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onDoubleClick={(e) => !(e.target as HTMLElement).closest(".bezel, button") && setView({ s: 1, x: 0, y: 0 })}
    >
      {!connected && hydrated && <Asleep />}
      {connected && placed.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-[13px]" style={{ color: "var(--text-3)" }}>
          <div className="flex flex-col items-center gap-2">
            <MonitorOff size={22} strokeWidth={1.5} />
            The {engine?.backend} backend hasn't reported any screens yet.
          </div>
        </div>
      )}
      <div className="absolute inset-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: "0 0", transition: panning ? "none" : "transform .12s ease-out" }}>
      {placed.map((p, i) => (
        <Screen
          key={p.m.name}
          p={p}
          canvas={spanCanvas(p, placed)}
          index={i}
          px={px}
          py={py}
          lit={carry?.target === p.m.name || !!carry?.target?.split(/[:+]/).includes(p.m.name)}
          arranging={arranging}
          moving={moving?.name === p.m.name}
          onMoveStart={(e) => startMove(p, e)}
          zoom={view.s}
        />
      ))}
      {!carry && placed.length > 1 && canBlend && <Seams zoom={view.s} placed={placed} pairs={engine?.blend_pairs ?? []} links={engine?.blend_links ?? {}} blends={engine?.blends ?? {}} />}
      <AnimatePresence>
        {carry &&
          bridges.map((b) => (
            <motion.div
              key={b.id}
              ref={(el) => registerTarget(b.id, el)}
              className="absolute grid place-items-center"
              style={{ left: b.left, top: b.top, width: b.w, height: b.h, zIndex: 5 }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            >
              <div
                className="rounded-[6px] transition-all duration-200"
                style={{
                  width: b.vertical ? (carry.target === b.id ? 10 : 4) : "70%",
                  height: b.vertical ? "70%" : carry.target === b.id ? 10 : 4,
                  background: carry.target === b.id ? "var(--accent)" : "rgba(255,255,255,.18)",
                  boxShadow: "none",
                }}
              />
            </motion.div>
          ))}
      </AnimatePresence>
      </div>
      {placed.length > 0 && canBlend && (
        <div className="absolute left-4 top-3 flex items-center gap-2 text-[12px]" style={{ zIndex: 6 }}>
          {!arranging && (
            <button
              className="tbtn !h-[26px] gap-1.5"
              title="A clock, the date, your own text, system info or battery, on your wallpaper"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const ms = engine?.monitors ?? [];
                useStore.getState().openMenu(
                  r.left,
                  r.bottom + 4,
                  addWidget.KINDS.map(([k, label]) =>
                    ms.length === 1 ? { label, onSelect: () => addWidget.add(k, ms[0].name) } : { label, submenu: ms.map((m) => ({ label: `On ${m.name}`, onSelect: () => addWidget.add(k, m.name) })) },
                  ),
                );
              }}
            >
              <Clock3 size={13} /> Add widget
            </button>
          )}
          {placed.length < 2 ? null : arranging ? (
            <>
              <span style={{ color: "var(--text-2)" }}>Drag the screens to match your desk. Edges snap together.</span>
              {customised && (
                <button className="tbtn !h-[26px]" onClick={() => send({ SetArrangement: {} })}>
                  Match system layout
                </button>
              )}
              <button className="btn btn-primary !h-[26px]" onClick={() => setArranging(false)}>
                Done
              </button>
            </>
          ) : (
            <button className="tbtn !h-[26px] gap-1.5" onClick={() => setArranging(true)} title="Move the screens to match how they really stand, for spans and blends">
              <Move size={13} /> Arrange screens
            </button>
          )}
        </div>
      )}
      <AnimatePresence>
        {view.s > 1.01 && (
          <motion.button
            className="absolute right-4 top-3 inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-[11px] font-medium"
            style={{ zIndex: 6, background: "rgba(20,20,26,.82)", boxShadow: "inset 0 0 0 1px var(--edge)", color: "var(--text-2)" }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            title="Back to the whole desk (or double-click empty space)"
            onClick={() => setView({ s: 1, x: 0, y: 0 })}
          >
            <span className="mono">{Math.round(view.s * 100)}%</span> · Reset
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function Screen({ p, canvas, index, px, py, lit, arranging, moving, onMoveStart, zoom }: { p: Placed; canvas: ReturnType<typeof spanCanvas>; index: number; px: ReturnType<typeof useSpring>; py: ReturnType<typeof useSpring>; lit: boolean; arranging: boolean; moving: boolean; onMoveStart(e: React.PointerEvent): void; zoom: number }) {
  const library = useStore((s) => s.library);
  const paused = useStore((s) => s.engine?.paused ?? "none");
  const carrying = useStore((s) => !!s.carry);
  const w = resolve(library, p.m.wallpaper);
  const canWidgets = useStore((s) => s.engine?.backend === "plasma" || s.engine?.backend === "mock");
  const onShelf = !!byPath(library, p.m.wallpaper);
  const thumb = useThumb(w);
  const [hover, setHover] = useState(false);

  return (
    <motion.div
      layout
      className={`bezel${arranging ? " cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left: p.left, top: p.top, width: p.w, height: p.h, zIndex: moving ? 4 : undefined, outline: arranging ? "1.5px dashed rgba(255,255,255,.28)" : undefined, outlineOffset: 3 }}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: lit || moving ? 1.015 : 1 }}
      transition={{ type: "spring", stiffness: 180, damping: 24, delay: 0.12 + index * 0.06, layout: moving ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 24 } }}
      onPointerDown={onMoveStart}
      onContextMenu={(e) => contextMenu(e, screenMenu(p.m))}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
    >
      <div ref={(el) => registerTarget(p.m.name, el)} className="screen">
        {canWidgets && <WidgetLayer monitor={p.m.name} interactive={!arranging && !carrying} zoom={zoom} />}
        <AnimatePresence mode="popLayout">
          {w ? (
            <motion.div key={`${w.id}:${p.m.span ?? ""}`} className="absolute" style={canvas} initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}>
              <LookLayer path={w.path}>
                <Preview look={w.look} src={thumb} px={px} py={py} paused={paused !== "none"} />
              </LookLayer>
            </motion.div>
          ) : (
            <motion.div key="empty" className="absolute inset-0 grid place-items-center text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="text-[13px] leading-[1.3]" style={{ color: "var(--text-3)" }}>
                {p.m.wallpaper ? "Unknown wallpaper" : carrying ? "Drop here" : "Empty screen"}
                <div className="text-[11px]" style={{ color: "var(--text-4)" }}>
                  {p.m.wallpaper ? p.m.wallpaper : "Drag a card up here"}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {paused !== "none" && w && (
            <motion.div className="absolute inset-0 grid place-items-center" style={{ background: "rgba(5,5,8,.35)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="glass-3 rounded-[8px] px-2.5 py-1 text-[11px] font-medium" style={{ color: "var(--text-2)" }}>
                Paused · {paused === "user" ? "by you" : paused}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>{lit && <motion.div className="target-ring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}</AnimatePresence>


      <div className="@container absolute left-0 right-0 -bottom-7 flex justify-center px-1">
      <div className="flex items-center gap-2 min-w-0 max-w-full whitespace-nowrap text-[11px]" style={{ color: "var(--text-3)" }}>
        <span className="font-semibold shrink-0" style={{ color: "var(--text-2)" }}>{p.m.name}</span>
        <span className="mono shrink-0 hidden @[440px]:inline">{p.m.width}×{p.m.height}</span>
        {p.m.primary && <span className="shrink-0 hidden @[520px]:inline" style={{ color: "var(--text-4)" }}>primary</span>}
        {w && <span className="truncate min-w-0" style={{ color: "var(--text-2)" }} title={w.name}>{w.name}{p.m.span ? " (spanned)" : ""}</span>}
        <Resting monitor={p.m.name} />
        <span className="shrink-0"><ScreenAutomations monitor={p.m.name} /></span>
        {w && !onShelf && (
          <button className="shrink-0 hidden @[560px]:inline text-[11px] underline-offset-2 hover:underline" style={{ color: "var(--text-2)" }} onClick={() => useStore.getState().addWallpaper({ ...w, developing: false })}>
            Add to shelf
          </button>
        )}
        <AnimatePresence>
          {hover && p.m.wallpaper && (
            <motion.button
              className="btn icon-btn shrink-0 !h-[20px] !w-[20px] !rounded-[6px]"
              title={`Clear ${p.m.name}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => clearScreen(p.m.name)}
            >
              <X size={12} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      </div>
    </motion.div>
  );
}

function Asleep() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <motion.div className="flex flex-col items-center gap-3 text-center" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex gap-3 opacity-40">
          {[0, 1].map((i) => (
            <div key={i} className="bezel !relative" style={{ width: 180, height: 102 }}>
              <div className="screen" />
            </div>
          ))}
        </div>
        <div className="text-[15px] font-medium tracking-[-0.005em]">The wallpaper engine is asleep</div>
        <div className="text-[13px] max-w-[340px]" style={{ color: "var(--text-2)" }}>
          It runs on its own so your wallpapers keep playing when this window closes.
        </div>
        <motion.button className="btn btn-primary" whileTap={{ scale: 0.97 }} onClick={async () => (await bridge).wake()}>
          <Power size={14} /> Wake it
        </motion.button>
      </motion.div>
    </div>
  );
}


function Resting({ monitor }: { monitor: string }) {
  const rest = useStore((s) => s.engine?.resting?.[monitor]);
  return (
    <AnimatePresence>
      {rest && (
        <motion.span
          className="shrink-0 inline-flex items-center gap-1.5 h-[18px] px-1.5 rounded-[6px] text-[11px] font-medium"
          style={{ color: "var(--warn)", background: "color-mix(in oklab, var(--warn) 14%, transparent)" }}
          title={rest === "calm" ? "Windows cover this screen, so it plays slower and dimmer" : "Windows cover this screen, so it's paused until you can see it again"}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
        >
          <span className="w-[5px] h-[5px] rounded-full" style={{ background: "var(--warn)" }} />
          {rest === "calm" ? "Calm" : "Paused"}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
