

import { AnimatePresence, motion } from "motion/react";
import { Copy, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Widget } from "../lib/types";
import * as W from "../lib/widgets";
import { Segmented, Slider } from "./Inspector";
import { Dropdown } from "./ui/Dropdown";
import { Switch } from "./ui/Switch";
import { useNow, WidgetFace } from "./WidgetLayer";

export function WidgetEditor() {
  const id = useStore((s) => s.editingWidget);
  const w = useStore((s) => s.engine?.widgets.find((x) => x.id === id));
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea") && useStore.getState().editWidget(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <AnimatePresence>
      {w && (
        <motion.aside
          key="widget-editor"
          className="glass-panel absolute top-[52px] right-3 bottom-3 w-[320px] rounded-[18px] flex flex-col overflow-hidden"
          style={{ zIndex: 20 }}
          initial={{ x: 360, opacity: 0.4 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 24 }}
        >
          <Body key={w.id} w={w} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Body({ w }: { w: Widget }) {
  const monitors = useStore((s) => s.engine?.monitors) ?? [];
  const accent = useStore((s) => s.engine?.accent ?? "#b35cff");
  const set = (patch: Partial<Widget>) => W.update(w.id, patch);
  const now = useNow();
  const color = w.color === "accent" ? accent : w.color;
  const [draft, setDraft] = useState(w.text);
  const title = W.KINDS.find(([k]) => k === w.kind)?.[1] ?? "Widget";
  const multiline = w.kind === "text" || w.kind === "system";

  return (
    <>

      <div className="relative h-[130px] shrink-0 m-2 rounded-[12px] grid place-items-center overflow-hidden" style={{ background: w.color === "#141418" ? "#d9d4cb" : "linear-gradient(160deg, #20202a, #0d0d12)" }}>
        <div className="max-w-full px-3 overflow-hidden">
          <WidgetFace w={{ ...w, opacity: Math.max(0.3, w.opacity) }} color={color} px={w.kind === "clock" && w.style === "analog" ? 34 : w.kind === "clock" ? 44 : 40} now={now} />
        </div>
        <button className="btn icon-btn absolute top-2 right-2 !bg-black/40" onClick={() => useStore.getState().editWidget(null)} title="Close (Esc)">
          <X size={14} />
        </button>
      </div>
      <div className="px-4 pt-1 pb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold tracking-[-0.005em]">{title}</div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>On {w.monitor} · drag it on the Stage to move, its corner to resize</div>
          {!monitors.find((m) => m.name === w.monitor)?.wallpaper && (
            <div className="text-[11px] mt-1" style={{ color: "var(--warn)" }}>Shows up once a ZWall wallpaper plays on {w.monitor}.</div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button className="btn icon-btn" title="Duplicate" onClick={() => W.duplicate(w.id)}>
            <Copy size={14} />
          </button>
          <button className="btn icon-btn" title="Remove" onClick={() => W.remove(w.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="scroll-fade flex-1 overflow-y-auto px-4 pt-2 pb-4 flex flex-col gap-4">

        {w.kind === "clock" && (
          <>
            <Segmented id="w-clock" label="Style" value={w.style} options={[["digital", "Digital"], ["minimal", "Minimal"], ["analog", "Analog"], ["words", "Words"]]} onChange={(style) => set({ style })} />
            {w.style !== "words" && (
              <div className="flex flex-col gap-2.5">
                {w.style !== "analog" && <Line label="24-hour"><Switch label="24-hour" on={w.hour24} onChange={(hour24) => set({ hour24 })} /></Line>}
                <Line label="Seconds"><Switch label="Seconds" on={w.seconds} onChange={(seconds) => set({ seconds })} /></Line>
              </div>
            )}
          </>
        )}
        {w.kind === "date" && <Segmented id="w-date" label="Format" value={w.style} options={[["long", "Long"], ["short", "Short"], ["weekday", "Weekday"]]} onChange={(style) => set({ style })} />}
        {w.kind === "text" && (
          <div>
            <div className="text-[13px] mb-1.5" style={{ color: "var(--text-2)" }}>Text</div>
            <textarea
              className="w-full min-h-[70px] px-2.5 py-2 rounded-[8px] text-[13px] outline-none resize-y"
              style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== w.text && set({ text: draft })}
            />
          </div>
        )}
        {w.kind === "system" && (
          <div>
            <div className="text-[13px] mb-1.5" style={{ color: "var(--text-2)" }}>Show</div>
            <div className="flex gap-1.5">
              {[["cpu", "CPU"], ["ram", "Memory"], ["uptime", "Uptime"]].map(([k, label]) => {
                const on = w.metrics.includes(k);
                return (
                  <button key={k} className="chip" data-on={on} style={on ? { background: "var(--e3)", color: "var(--text)" } : undefined} onClick={() => set({ metrics: on ? w.metrics.filter((x) => x !== k) : [...w.metrics, k] })}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}


        <div>
          <div className="text-[13px] mb-2" style={{ color: "var(--text-2)" }}>Colour</div>
          <div className="flex flex-wrap gap-2 items-center">
            {W.SCHEMES.map(([name, hex, effect]) => (
              <button
                key={name}
                title={name}
                aria-label={name}
                className="w-[26px] h-[26px] rounded-full transition-transform hover:scale-110"
                style={{ background: hex, boxShadow: w.color === hex ? "0 0 0 2px var(--panel-2), 0 0 0 4px var(--text)" : "inset 0 0 0 1px rgba(255,255,255,.2)" }}
                onClick={() => set({ color: hex, effect: w.effect === "none" && effect !== "none" ? w.effect : effect })}
              />
            ))}
            <button
              title="Follow the wallpaper's colour"
              className="h-[26px] px-2 rounded-full text-[11px] font-medium inline-flex items-center gap-1.5"
              style={{ background: "var(--e2)", color: "var(--text-2)", boxShadow: w.color === "accent" ? "0 0 0 2px var(--panel-2), 0 0 0 4px var(--text)" : undefined }}
              onClick={() => set({ color: "accent" })}
            >
              <span className="w-[10px] h-[10px] rounded-full" style={{ background: accent }} /> Wallpaper
            </button>
            <label className="relative h-[26px] px-2 rounded-full text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer" style={{ background: "var(--e2)", color: "var(--text-2)" }} title="Pick any colour">
              <span className="w-[10px] h-[10px] rounded-full" style={{ background: "conic-gradient(#f55, #fd5, #5f8, #5cf, #a6f, #f55)" }} />
              Own
              <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={/^#[0-9a-f]{6}$/i.test(w.color) ? w.color : "#f3efe6"} onChange={(e) => set({ color: e.target.value })} />
            </label>
          </div>
        </div>
        <Segmented id="w-effect" label="Effect" value={w.effect} options={[["none", "None"], ["shadow", "Shadow"], ["glow", "Glow"]]} onChange={(effect) => set({ effect })} />
        {!(w.kind === "clock" && w.style === "analog") && (
          <>
            <FontPicker value={w.font} weight={w.weight} onChange={(font) => set({ font })} />
            <Segmented id="w-weight" label="Weight" value={String(w.weight)} options={[["200", "Thin"], ["300", "Light"], ["400", "Regular"], ["600", "Semi"], ["800", "Heavy"]]} onChange={(v) => set({ weight: Number(v) })} />
          </>
        )}
        <Slider label="Size" value={w.size} min={0.015} max={0.4} step={0.005} format={(v) => `${Math.round(v * 1000) / 10}%`} onChange={(size) => set({ size })} />
        <Slider label="Opacity" value={w.opacity} min={0.1} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => set({ opacity })} reset={0.95} />
        {multiline && <Segmented id="w-align" label="Align lines" value={w.align} options={[["left", "Left"], ["center", "Centre"], ["right", "Right"]]} onChange={(align) => set({ align })} />}


        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px]" style={{ color: "var(--text-2)" }}>Screen</span>
          <Dropdown<string> label="Screen" value={w.monitor} width={140} options={monitors.map((m) => [m.name, m.name])} onChange={(monitor) => set({ monitor })} />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(
            [
              ["Top left", 0.15, 0.12],
              ["Top", 0.5, 0.12],
              ["Centre", 0.5, 0.45],
              ["Bottom left", 0.15, 0.88],
              ["Bottom right", 0.85, 0.88],
            ] as const
          ).map(([label, x, y]) => (
            <button key={label} className="tbtn !h-[24px] !px-2 text-[11px]" style={{ background: "var(--e1)" }} onClick={() => set({ x, y })}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px]" style={{ color: "var(--text-2)" }}>{label}</span>
      {children}
    </div>
  );
}


function FontPicker({ value, weight, onChange }: { value: string; weight: number; onChange(font: string): void }) {
  const fonts = useStore((s) => s.engine?.fonts) ?? [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => fonts.filter((f) => f.toLowerCase().includes(q.toLowerCase())).slice(0, 150), [fonts, q]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <div className="text-[13px] mb-1.5" style={{ color: "var(--text-2)" }}>Font</div>
      <button className="w-full h-[34px] px-3 rounded-[9px] text-left text-[15px] truncate" style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)", fontFamily: value ? `"${value}"` : undefined, fontWeight: weight }} onClick={() => setOpen(!open)}>
        {value || "System font"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="mt-1.5 rounded-[10px] overflow-hidden flex flex-col" style={{ maxHeight: 280, background: "var(--panel)", border: "1px solid var(--edge)" }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <div className="flex items-center gap-2 px-2.5 h-[34px] border-b shrink-0" style={{ borderColor: "var(--edge)" }}>
              <Search size={13} style={{ color: "var(--text-3)" }} />
              <input autoFocus className="flex-1 bg-transparent outline-none text-[13px]" placeholder={`Search ${fonts.length} fonts`} value={q} onChange={(e) => setQ(e.target.value)} style={{ color: "var(--text)" }} />
            </div>
            <div className="overflow-y-auto p-1">
              <button className="w-full text-left px-2.5 py-1.5 rounded-[7px] text-[14px] hover:bg-[var(--e2)]" onClick={() => (onChange(""), setOpen(false))}>
                System font
              </button>
              {shown.map((f) => (
                <button key={f} className="w-full text-left px-2.5 py-1.5 rounded-[7px] text-[15px] truncate hover:bg-[var(--e2)]" style={{ fontFamily: `"${f}"`, color: f === value ? "var(--text)" : "var(--text-2)", background: f === value ? "var(--e2)" : undefined }} onClick={() => (onChange(f), setOpen(false))}>
                  {f}
                </button>
              ))}
              {shown.length === 0 && <div className="px-2.5 py-3 text-[12px]" style={{ color: "var(--text-3)" }}>No font matches “{q}”.</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
