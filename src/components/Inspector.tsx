import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import { ExternalLink, Eye, Heart, Layers, Monitor, RotateCcw, Share2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { place, send } from "../lib/actions";
import { KIND_LABEL } from "../lib/presets";
import { useStore, useThumb } from "../lib/store";
import { DEFAULT_PARAMS, type Meta, type Motion, type Overlay, type Params, type Tint, type Wallpaper } from "../lib/types";
import { bridge } from "../lib/ipc";
import { RES_LABEL, resOf } from "../lib/search";
import { LookLayer, Preview } from "./Preview";
import { Toggle } from "./SettingsPanel";
import { removeWallpapers } from "../lib/undo";
import { tryOn } from "../lib/trial";

export function Inspector() {
  const id = useStore((s) => s.inspecting);
  const w = useStore((s) => s.library.find((x) => x.id === id));
  return (
    <AnimatePresence>
      {w && (
        <motion.aside
          key="inspector"
          className="glass-panel absolute top-[52px] right-3 bottom-3 w-[320px] rounded-[18px] flex flex-col overflow-hidden"
          style={{ zIndex: 20 }}
          initial={{ x: 360, opacity: 0.4 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 24 }}
        >
          <InspectorBody key={w.id} w={w} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

export const screenKey = (path: string, monitor: string) => `${path}#screen=${monitor}`;

function useLiveParams(path: string, fallback?: string) {
  const own = useStore((s) => s.engine?.params?.[path]);
  const shared = useStore((s) => (fallback ? s.engine?.params?.[fallback] : undefined));
  const remote = own ?? shared;
  const [p, setP] = useState<Params>(remote ?? DEFAULT_PARAMS);
  const pending = useRef<Params | null>(null);
  const frame = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current && !pending.current) setP(remote ?? DEFAULT_PARAMS);
  }, [remote]);

  useEffect(() => {
    pending.current = null;
    setP(remote ?? DEFAULT_PARAMS);
  }, [path]);

  const update = (patch: Partial<Params>) => {
    const next = { ...p, ...patch };
    setP(next);
    pending.current = next;
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pending.current) send({ SetParams: { path, params: pending.current } });
        pending.current = null;
      });
  };
  return { p, update, setDragging: (v: boolean) => (dragging.current = v) };
}

export function InspectorBody({ w }: { w: Wallpaper }) {
  const { inspect, setFavourite } = useStore.getState();
  const monitors = useStore((s) => s.engine?.monitors ?? []);
  const accent = useStore((s) => s.engine?.accent ?? null);
  const master = useStore((s) => s.engine?.settings);
  const playingOn = monitors.filter((m) => m.wallpaper === w.path).map((m) => m.name);
  const thumb = useThumb(w);

  const [scope, setScope] = useState("all");
  const scoped = scope !== "all" && playingOn.includes(scope);
  const key = scoped ? screenKey(w.path, scope) : w.path;
  const ownLooks = useStore((s) => playingOn.filter((m) => s.engine?.params?.[screenKey(w.path, m)]).join(","));
  const { p, update, setDragging } = useLiveParams(key, scoped ? w.path : undefined);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const px = useSpring(mx, { stiffness: 120, damping: 20 });
  const py = useSpring(my, { stiffness: 120, damping: 20 });
  const stagger = (i: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { type: "spring" as const, stiffness: 300, damping: 30, delay: 0.12 + i * 0.04 } });
  const changed = JSON.stringify(p) !== JSON.stringify(DEFAULT_PARAMS);

  return (
    <>
      <div
        className="relative h-[170px] shrink-0 m-2 rounded-[12px] overflow-hidden"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          mx.set((((e.clientX - r.left) / r.width) * 2 - 1) * p.depth);
          my.set((((e.clientY - r.top) / r.height) * 2 - 1) * p.depth);
        }}
        onPointerLeave={() => (mx.set(0), my.set(0))}
      >
        <LookLayer path={w.path}>
          <Preview look={w.look} src={thumb} px={px} py={py} />
        </LookLayer>
        <button className="btn icon-btn absolute top-2 right-2 !bg-black/40" onClick={() => inspect(null)} title="Close (Esc)">
          <X size={14} />
        </button>
        <AnimatePresence>
          {playingOn.length > 0 && (
            <motion.span
              className="absolute left-2 bottom-2 glass-3 rounded-[7px] px-2 py-0.5 text-[11px] font-medium flex items-center gap-1.5"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              On {playingOn.join(" + ")}. Changes show there as you make them
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="px-4 pt-2 pb-3 flex items-start justify-between gap-2">
        <motion.div {...stagger(0)} className="min-w-0">
          <div className="text-[20px] font-semibold tracking-[-0.005em] leading-[1.15] truncate">{w.name}</div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-3)" }} title={w.path}>
            {KIND_LABEL[w.kind]} · {w.path.startsWith("preset://") ? "built in" : w.path.split(/[\\/]/).pop()}
          </div>
          {w.kind === "photo" && <DepthStatus path={w.path} />}
        </motion.div>
        <div className="flex gap-1 shrink-0">
          <motion.button className="btn icon-btn" whileTap={{ scale: 0.9 }} title="Share as .zwall (saved to Pictures/ZWall)" onClick={() => send({ Export: { path: w.path, name: w.name } })}>
            <Share2 size={14} />
          </motion.button>
          {w.own && (
            <motion.button className="btn icon-btn" whileTap={{ scale: 0.9 }} title="Remove from shelf" onClick={() => removeWallpapers([w])}>
              <Trash2 size={14} />
            </motion.button>
          )}
          <motion.button className="btn icon-btn" whileTap={{ scale: 0.9 }} onClick={() => setFavourite(w, !w.fav)} title={w.fav ? "Unfavourite" : "Favourite"}>
            <Heart size={14} fill={w.fav ? "currentColor" : "none"} style={{ color: w.fav ? "var(--err)" : undefined }} />
          </motion.button>
        </div>
      </div>

      <div className="scroll-fade flex-1 overflow-y-auto px-4 pt-2 flex flex-col gap-4 pb-4" onPointerDown={() => setDragging(true)} onPointerUp={() => setDragging(false)}>
        <TagEditor w={w} />
        {playingOn.length > 1 && <ScopePicker screens={playingOn} scope={scoped ? scope : "all"} own={ownLooks ? ownLooks.split(",") : []} onScope={setScope} path={w.path} />}
        {(w.kind === "shader" || w.kind === "video") && (
          <motion.div {...stagger(1)}>
            <Slider reset={1}
              label={w.kind === "video" ? "Playback speed" : "Speed"}
              value={p.speed}
              min={w.kind === "video" ? 0.25 : 0}
              max={w.kind === "video" ? 2 : 3}
              step={0.05}
              format={(v) => (w.kind === "video" ? `${v.toFixed(2)}×` : `${Math.round(v * 100)}%`)}
              onChange={(speed) => update({ speed })}
            />
          </motion.div>
        )}
        {w.kind === "web" && (
          <div className="text-[11px] leading-[1.5]" style={{ color: "var(--text-3)" }}>
            A web page as your wallpaper. It gets your cursor and desktop clicks, and freezes while ZWall is paused. Pages run their own scripts, so only use ones you trust. Needs KDE Plasma for now.
          </div>
        )}
        {(w.kind === "video" || w.kind === "web") && (
          <motion.div {...stagger(2)}>
            <Slider reset={1} label="Volume" value={p.volume} min={0} max={1} step={0.01} format={(v) => (v === 0 ? "silent" : `${Math.round(v * 100)}%`)} onChange={(volume) => update({ volume })} />
            {master && (master.mute || master.volume === 0) && (
              <button className="mt-2 text-[11px] underline-offset-2 hover:underline" style={{ color: "var(--warn)" }} onClick={() => useStore.getState().openSettings(true)}>
                Sound is off in Settings. Turn it on →
              </button>
            )}
            <div className="text-[11px] mt-2 leading-[1.4]" style={{ color: "var(--text-3)" }}>
              {w.kind === "web" ? "Pages can only be on or muted; the level is set inside the page." : "When it plays on several screens, only one copy is heard."}
            </div>
          </motion.div>
        )}
        {w.kind === "video" && <LoopMaker path={w.path} />}
        {w.kind !== "video" && w.kind !== "web" && (<>
        <motion.div {...stagger(2)}>
          <Slider reset={1}
            label={w.kind === "photo" ? "Exposure" : "Intensity"}
            value={p.intensity}
            min={0}
            max={1.5}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(intensity) => update({ intensity })}
          />
        </motion.div>
        <motion.div {...stagger(3)}>
          <Slider reset={0} label="Depth" value={p.depth} min={0} max={2} step={0.05} format={(v) => (v === 0 ? "flat" : `${Math.round(v * 100)}%`)} onChange={(depth) => update({ depth })} />
        </motion.div>
        {w.kind === "photo" && <Life path={w.path} value={p.life ?? 1} onChange={(life) => update({ life })} />}
        <motion.div {...stagger(4)}>
          <Segmented<Motion>
            id="motion"
            label="Moves with"
            value={p.motion}
            options={[
              ["mouse", "Your cursor"],
              ["drift", "Slow drift"],
              ["still", "Still"],
            ]}
            onChange={(motion) => update({ motion })}
          />
        </motion.div>
        <motion.div {...stagger(5)}>
          <Segmented<Tint>
            id="tint"
            label="Colour"
            value={p.tint}
            options={[
              ["original", "Original"],
              ["accent", "Accent"],
              ["mono", "Mono"],
            ]}
            swatch={accent}
            onChange={(tint) => update({ tint })}
          />
        </motion.div>
        </>)}
        <motion.div {...stagger(6)}>
          <Segmented<Overlay>
            id="overlay"
            label="Weather on top"
            value={p.overlay}
            options={[
              ["none", "None"],
              ["rain", "Rain"],
              ["snow", "Snow"],
              ["fireflies", "Fireflies"],
              ["grain", "Grain"],
            ]}
            onChange={(overlay) => update({ overlay })}
          />
        </motion.div>
        {p.overlay !== "none" && (
          <Slider reset={1} label="Weather strength" value={p.overlay_amount} min={0} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(overlay_amount) => update({ overlay_amount })} />
        )}
        <AnimatePresence>
          {changed && (
            <motion.button
              className="btn self-start"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => update(DEFAULT_PARAMS)}
            >
              <RotateCcw size={13} /> Reset to original
            </motion.button>
          )}
        </AnimatePresence>
        <Details w={w} />
      </div>

      <div className="p-3 flex flex-col gap-1.5 border-t" style={{ borderColor: "var(--edge)" }}>
        <div className="text-[12px] px-0.5" style={{ color: "var(--text-3)" }}>Play on</div>
        <div className="flex gap-1.5">
          {[...monitors.map((m) => m.name), ...(monitors.length > 1 ? ["all"] : [])].map((t) => {
            const on = t === "all" ? monitors.every((m) => m.wallpaper === w.path) : monitors.find((m) => m.name === t)?.wallpaper === w.path;
            return (
              <motion.button key={t} className="btn flex-1 justify-center" data-on={on} whileTap={{ scale: 0.97 }} onClick={() => place(w, t)} title={t === "all" ? "Play on every screen" : `Play on ${t}`}>
                {t === "all" ? <Layers size={13} /> : <Monitor size={13} />} {t === "all" ? "All screens" : t}
              </motion.button>
            );
          })}
        </div>
        <button
          className="tbtn self-center !h-[26px] text-[12px] gap-1.5"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            useStore.getState().openMenu(r.left, r.top - 8 - monitors.length * 30, monitors.map((m) => ({ label: `Try on ${m.name}`, onSelect: () => tryOn(w, m.name) })));
          }}
        >
          <Eye size={13} /> Try it on a screen first…
        </button>
      </div>
    </>
  );
}

export function Slider({ label, value: committed, min, max, step, format, onChange, reset }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange(v: number): void; reset?: number }) {
  const [draft, setDraft] = useState<number | null>(null);
  const latest = useRef<number | null>(null);
  const value = draft ?? committed;
  const commit = () => {
    const v = latest.current;
    latest.current = null;
    if (v !== null && v !== committed) onChange(v);
    setDraft(null);
  };

  const startDrag = () => {
    const done = () => {
      window.removeEventListener("pointerup", done, true);
      window.removeEventListener("mouseup", done, true);
      commit();
    };
    window.addEventListener("pointerup", done, true);
    window.addEventListener("mouseup", done, true);
  };
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between text-[13px] mb-1.5">
        <span style={{ color: "var(--text-2)" }}>{label}</span>
        <span className="mono text-[11px]" style={{ color: "var(--text-3)" }}>{format(value)}</span>
      </div>
      <div className="relative h-[22px] group">
        <div className="absolute inset-x-0 top-[10px] h-[2px] rounded-[1px]" style={{ background: "var(--e4)" }} />
        <div className="absolute left-0 top-[10px] h-[2px] rounded-[1px]" style={{ width: `${pct}%`, background: "var(--accent)" }} />

        {reset !== undefined && reset > min && reset < max && (
          <div className="absolute top-[7px] w-[2px] h-[8px] -ml-[1px] rounded-[1px] pointer-events-none" style={{ left: `${((reset - min) / (max - min)) * 100}%`, background: "var(--text-4)" }} />
        )}
        <div
          className="absolute top-[4px] w-[14px] h-[14px] rounded-[5px] -ml-[7px] pointer-events-none transition-transform duration-150 group-hover:scale-110 group-active:scale-95"
          style={{ left: `${pct}%`, background: "var(--accent)", boxShadow: "0 1px 3px rgba(0,0,0,.5)" }}
        />
        <input
          type="range"
          aria-label={label}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            latest.current = +e.target.value;
            setDraft(+e.target.value);
          }}
          onPointerDown={startDrag}
          onDoubleClick={() => {
            if (reset === undefined) return;
            latest.current = null;
            setDraft(null);
            onChange(reset);
          }}
          title={reset !== undefined ? `Double-click to reset to ${format(reset)}` : undefined}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ id, label, value, options, swatch, onChange }: { id: string; label: string; value: T; options: [T, string][]; swatch?: string | null; onChange(v: T): void }) {
  return (
    <div>
      <div className="text-[13px] mb-1.5" style={{ color: "var(--text-2)" }}>{label}</div>
      <div className="flex p-[3px] rounded-[10px]" style={{ background: "var(--e1)", border: "1px solid var(--edge)" }}>
        {options.map(([v, text]) => (
          <button key={v} className="relative flex-1 h-[26px] text-[11px] font-medium focusable rounded-[7px]" style={{ color: value === v ? "var(--text)" : "var(--text-3)" }} onClick={() => onChange(v)}>
            {value === v && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[7px]" style={{ background: "var(--e4)", boxShadow: "inset 0 1px 0 var(--edge-top)" }} transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
            <span className="relative inline-flex items-center gap-1.5">
              {v === "accent" && swatch && <span className="w-[8px] h-[8px] rounded-[3px]" style={{ background: swatch }} />}
              {text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LoopMaker({ path }: { path: string }) {
  const duration = useStore((s) => s.engine?.durations?.[path]);
  const job = useStore((s) => s.engine?.jobs?.[path]);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [fade, setFade] = useState(1);
  const [best, setBest] = useState(true);
  if (!duration) return null;
  const [start, end] = range ?? [0, duration];
  const fmt = (v: number) => `${v.toFixed(1)} s`;
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--text-3)" }}>Seamless loop</div>
      <Slider label="Start" value={start} min={0} max={duration} step={0.1} format={fmt} onChange={(v) => setRange([Math.min(v, end - 1), end])} />
      <Slider label="End" value={end} min={0} max={duration} step={0.1} format={fmt} onChange={(v) => setRange([start, Math.max(v, start + 1)])} />
      <Slider label="Blend the seam over" value={fade} min={0.2} max={3} step={0.1} format={fmt} onChange={setFade} />
      <Toggle label="Find the best loop point" hint="Moves the end to the frame that looks most like the start." on={best} onChange={setBest} />
      <button className="btn justify-center" disabled={!!job} onClick={() => send({ MakeLoop: { path, start, end, crossfade: fade, find_best: best } })}>
        {job ?? "Make seamless loop"}
      </button>
      <div className="text-[11px] leading-[1.4]" style={{ color: "var(--text-3)" }}>
        Makes a new copy on your shelf. The original stays as it is.
      </div>
    </div>
  );
}

function DepthStatus({ path }: { path: string }) {
  const job = useStore((s) => s.engine?.jobs?.[path]);
  const ready = useStore((s) => !!s.engine?.depths?.[path]);
  const on = useStore((s) => (s.engine?.params?.[path]?.depth ?? 0) > 0);
  const text = job ?? (!on ? "Flat. Turn up Depth for 3D parallax." : ready ? "3D depth ready: near things move more than far ones" : "Finding depth…");
  return (
    <div className="text-[11px] mt-1" style={{ color: ready ? "var(--text-2)" : "var(--text-3)" }}>
      {text}
    </div>
  );
}

function TagEditor({ w }: { w: Wallpaper }) {
  const library = useStore((s) => s.library);
  const [draft, setDraft] = useState("");
  const save = (tags: string[]) => send({ SetTags: { path: w.path, tags } });
  const add = (t: string) => {
    const tag = t.trim().toLowerCase();
    if (tag && !w.tags.includes(tag)) save([...w.tags, tag]);
    setDraft("");
  };
  const known = [...new Set(library.flatMap((x) => x.tags))].filter((t) => !w.tags.includes(t));
  const suggestions = draft ? known.filter((t) => t.startsWith(draft.toLowerCase())).slice(0, 5) : [];
  return (
    <div>
      <div className="text-[13px] mb-1.5" style={{ color: "var(--text-2)" }}>Tags</div>
      <div className="flex flex-wrap gap-1.5">
        {w.tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 h-[22px] pl-2 pr-1 rounded-[6px] text-[11px]" style={{ background: "var(--e2)" }}>
            {t}
            <button className="tbtn !h-[16px] !px-1" aria-label={`Remove tag ${t}`} onClick={() => save(w.tags.filter((x) => x !== t))}>
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          className="h-[22px] min-w-[90px] flex-1 px-1.5 rounded-[6px] text-[11px] outline-none"
          style={{ background: "transparent", color: "var(--text)" }}
          placeholder={w.tags.length ? "Add tag" : "Add tags, e.g. night, calm"}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(",", ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") (e.preventDefault(), add(draft));
            if (e.key === "Backspace" && !draft && w.tags.length) save(w.tags.slice(0, -1));
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {suggestions.map((t) => (
            <button key={t} className="tbtn !h-[20px] !px-1.5 text-[11px]" onClick={() => add(t)}>
              + {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Details({ w }: { w: Wallpaper }) {
  const facts = useStore((s) => s.engine?.facts?.[w.path]);
  const duration = useStore((s) => s.engine?.durations?.[w.path]);
  const meta = w.meta ?? {};
  const save = (patch: Partial<Meta>) => send({ SetMeta: { path: w.path, meta: { ...meta, ...patch } } });
  const ownSize = !!(meta.width && meta.height);
  const res = resOf(w);
  const fmtBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
  const fmtLen = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
  const link = /^https?:\/\//.test(meta.source ?? "") ? meta.source : undefined;
  return (
    <section className="flex flex-col gap-0.5">
      <div className="text-[13px] mb-1" style={{ color: "var(--text-2)" }}>Details</div>
      <Field label="Title" value={meta.title ?? ""} placeholder={w.fileName ?? w.name} onSave={(title) => save({ title })} />
      <Field label="Author" value={meta.author ?? ""} placeholder="Who made it" onSave={(author) => save({ author })} />
      <Field
        label="Source"
        value={meta.source ?? ""}
        placeholder="Link or where it's from"
        onSave={(source) => save({ source })}
        extra={
          link && (
            <button className="tbtn !h-[22px] !px-1 shrink-0" title={`Open ${link}`} aria-label="Open source link" onClick={() => bridge.then((b) => b.openLink(link))}>
              <ExternalLink size={12} />
            </button>
          )
        }
      />
      <div className="flex items-center gap-2 min-h-[28px]">
        <span className="w-[64px] shrink-0 text-[12px]" style={{ color: "var(--text-3)" }}>Size</span>
        {w.kind === "shader" ? (
          <span className="text-[12px] px-1.5" style={{ color: "var(--text-2)" }}>Draws sharp at any size</span>
        ) : (
          <>
            <NumField value={meta.width} placeholder={facts?.width || undefined} label="Width" onSave={(width) => save({ width, height: meta.height ?? (facts?.height || undefined) })} />
            <span className="text-[12px]" style={{ color: "var(--text-4)" }}>×</span>
            <NumField value={meta.height} placeholder={facts?.height || undefined} label="Height" onSave={(height) => save({ height, width: meta.width ?? (facts?.width || undefined) })} />
            {res !== "any" && <span className="text-[11px] px-1.5 h-[18px] leading-[18px] rounded-[5px] shrink-0" style={{ background: "var(--e2)", color: "var(--text-2)" }}>{RES_LABEL[res]}</span>}
            {ownSize && (
              <button className="tbtn !h-[22px] !px-1 shrink-0" title="Use the detected size" aria-label="Use the detected size" onClick={() => save({ width: undefined, height: undefined })}>
                <RotateCcw size={11} />
              </button>
            )}
          </>
        )}
      </div>
      <Field label="Notes" value={meta.notes ?? ""} placeholder="Anything to remember" multiline onSave={(notes) => save({ notes })} />
      <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 mt-1.5 text-[12px]">
        {w.own && w.fileName && (
          <>
            <span style={{ color: "var(--text-3)" }}>File</span>
            <span className="truncate" style={{ color: "var(--text-2)" }} title={w.path}>{w.path.split(/[\\/]/).pop()}</span>
          </>
        )}
        {!!w.bytes && (
          <>
            <span style={{ color: "var(--text-3)" }}>File size</span>
            <span className="mono" style={{ color: "var(--text-2)" }}>{fmtBytes(w.bytes)}</span>
          </>
        )}
        {!!duration && (
          <>
            <span style={{ color: "var(--text-3)" }}>Length</span>
            <span className="mono" style={{ color: "var(--text-2)" }}>{fmtLen(duration)}</span>
          </>
        )}
        {!!w.added && (
          <>
            <span style={{ color: "var(--text-3)" }}>Added</span>
            <span style={{ color: "var(--text-2)" }}>{new Date(w.added * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
          </>
        )}
      </div>
    </section>
  );
}

function Field({ label, value, placeholder, multiline, onSave, extra }: { label: string; value: string; placeholder?: string; multiline?: boolean; onSave(v: string): void; extra?: React.ReactNode }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft.trim() !== value && onSave(draft.trim());
  const cls = "flex-1 min-w-0 px-1.5 rounded-[6px] text-[12px] outline-none bg-transparent border border-transparent transition-colors hover:bg-[var(--e1)] focus:bg-[var(--e1)] focus:border-[var(--edge)] placeholder:text-[var(--text-4)]";
  return (
    <label className={`flex gap-2 min-h-[28px] ${multiline ? "items-start pt-1" : "items-center"}`}>
      <span className={`w-[64px] shrink-0 text-[12px] ${multiline ? "pt-[3px]" : ""}`} style={{ color: "var(--text-3)" }}>{label}</span>
      {multiline ? (
        <textarea
          className={`${cls} py-1 resize-none leading-[1.45]`}
          rows={Math.min(5, Math.max(2, draft.split("\n").length))}
          style={{ color: "var(--text)" }}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Escape" && (setDraft(value), (e.target as HTMLElement).blur())}
        />
      ) : (
        <input
          className={`${cls} h-[24px]`}
          style={{ color: "var(--text)" }}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLElement).blur();
            if (e.key === "Escape") (setDraft(value), (e.target as HTMLElement).blur());
          }}
        />
      )}
      {extra}
    </label>
  );
}

function NumField({ value, placeholder, label, onSave }: { value?: number; placeholder?: number; label: string; onSave(v: number | undefined): void }) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  useEffect(() => setDraft(value ? String(value) : ""), [value]);
  const commit = () => {
    const n = parseInt(draft, 10);
    const next = Number.isFinite(n) && n > 0 ? Math.min(n, 65535) : undefined;
    if (next !== value) onSave(next);
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      className="mono w-[58px] h-[24px] px-1.5 rounded-[6px] text-[12px] outline-none bg-transparent border border-transparent transition-colors hover:bg-[var(--e1)] focus:bg-[var(--e1)] focus:border-[var(--edge)] placeholder:text-[var(--text-3)]"
      style={{ color: "var(--text)" }}
      value={draft}
      placeholder={placeholder ? String(placeholder) : "—"}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "Escape") (setDraft(value ? String(value) : ""), (e.target as HTMLElement).blur());
      }}
    />
  );
}

function Life({ path, value, onChange }: { path: string; value: number; onChange(v: number): void }) {
  const found = useStore((s) => s.engine?.scenes?.[path]?.found);
  const what: Record<string, string> = { sky: "the sky drifts and its stars twinkle", water: "water ripples", plants: "plants sway", lights: "lights glow" };
  const hint = value === 0
    ? "Off. Turn it up and ZWall finds the sky, water, plants and lights to animate."
    : !found
    ? "Looking at what's in the picture…"
    : found.length
      ? `${found.map((f) => what[f] ?? f).join(", ")}.`.replace(/^./, (c) => c.toUpperCase())
      : "Nothing here that moves on its own (no sky, water, plants or lights found).";
  return (
    <div>
      <Slider reset={0} label="Bring it to life" value={value} min={0} max={1.5} step={0.05} format={(v) => (v === 0 ? "off" : `${Math.round(v * 100)}%`)} onChange={onChange} />
      <div className="text-[11px] -mt-0.5 leading-[1.4]" style={{ color: "var(--text-3)" }}>
        {hint}
      </div>
    </div>
  );
}

function ScopePicker({ screens, scope, own, onScope, path }: { screens: string[]; scope: string; own: string[]; onScope(s: string): void; path: string }) {
  return (
    <div>
      <div className="text-[13px] mb-1.5" style={{ color: "var(--text-2)" }}>Applies to</div>
      <div className="flex p-[3px] rounded-[10px]" style={{ background: "var(--e1)", border: "1px solid var(--edge)" }}>
        {["all", ...screens].map((s) => {
          const on = scope === s;
          return (
            <button key={s} className="relative flex-1 h-[26px] text-[12px] font-medium rounded-[7px] focusable" style={{ color: on ? "var(--text)" : "var(--text-3)" }} onClick={() => onScope(s)}>
              {on && <motion.span layoutId="scope" className="absolute inset-0 rounded-[7px]" style={{ background: "var(--e4)" }} transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
              <span className="relative">
                {s === "all" ? "All screens" : s}
                {s !== "all" && own.includes(s) && <span style={{ color: "var(--warn)" }}> •</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="text-[12px] mt-1.5 leading-[1.4]" style={{ color: "var(--text-3)" }}>
        {scope === "all" ? (
          own.length ? `${own.join(" and ")} ${own.length === 1 ? "has" : "have"} a look of ${own.length === 1 ? "its" : "their"} own.` : "Changes show on every screen playing it."
        ) : own.includes(scope) ? (
          <>
            {scope} has its own look.{" "}
            <button className="underline underline-offset-2" style={{ color: "var(--text-2)" }} onClick={() => send({ ClearParams: { path: screenKey(path, scope) } })}>
              Use the shared look
            </button>
          </>
        ) : (
          `Changes here only affect ${scope}.`
        )}
      </div>
    </div>
  );
}
