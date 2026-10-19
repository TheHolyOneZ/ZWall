import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Minus, Pause as PauseIcon, Play, Square, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LookLayer, Preview } from "./Preview";
import { useThumb } from "../lib/store";
import { send } from "../lib/actions";
import { bridge } from "../lib/ipc";
import { useStore } from "../lib/store";
import type { Settings } from "../lib/types";
import { Tip } from "./Tip";

const REASON: Record<string, string> = {
  user: "Paused",
  fullscreen: "Paused while an app is fullscreen",
  covered: "Paused while the desktop is covered",
  battery: "Paused on battery",
  app: "Paused while an app runs",
  idle: "Paused while you're away",
  locked: "Paused while the screen is locked",
};

export function TitleBar() {
  const engine = useStore((s) => s.engine);
  const connected = useStore((s) => s.connected);
  const hydrated = useStore((s) => s.hydrated);
  const paused = engine?.paused ?? "none";
  const settingsOpen = useStore((s) => s.settingsOpen);
  const win = async () => (await bridge).window;
  const notice = !connected ? (hydrated ? "Engine not running" : null) : paused !== "none" ? REASON[paused] : null;

  return (
    <motion.header
      data-tauri-drag-region
      className="relative flex items-center h-[48px] pl-4 pr-2 shrink-0"
      style={{ zIndex: 30 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24 }}
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 pointer-events-none">
        <img src="/icon-64.png" width={18} height={18} alt="" draggable={false} className="rounded-[4px]" />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">ZWall</span>
      </div>
      <ModeSwitch />

      <div data-tauri-drag-region className="flex-1" />

      <AnimatePresence>
        {notice && (
          <motion.span
            key={notice}
            className="text-[12px] mr-3"
            style={{ color: "var(--warn)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {notice}
          </motion.span>
        )}
      </AnimatePresence>

      <nav className="flex items-center">
        {connected && engine && <NowPlaying />}
        {connected && (
          <button className="tbtn" style={settingsOpen ? { color: "var(--text)", background: "var(--e2)" } : undefined} onClick={() => useStore.getState().openSettings(!settingsOpen)}>
            Settings
          </button>
        )}
        <span className="w-px h-4 mx-2" style={{ background: "var(--edge)" }} />
        <Tip label="Minimise">
          <button className="tbtn !px-2" aria-label="Minimise" onClick={async () => (await win()).minimize()}>
            <Minus size={14} />
          </button>
        </Tip>
        <Tip label="Maximise">
          <button className="tbtn !px-2" aria-label="Maximise" onClick={async () => (await win()).toggleMaximize()}>
            <Square size={11} />
          </button>
        </Tip>
        <Tip label="Close. Wallpapers keep playing">
          <button className="tbtn !px-2 hover:!text-[var(--err)]" aria-label="Close" onClick={async () => (await win()).hide()}>
            <X size={15} />
          </button>
        </Tip>
      </nav>
    </motion.header>
  );
}

function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  return (
    <nav className="flex items-center ml-6" aria-label="View">
      {(["stage", "library", "automate"] as const).map((m) => (
        <button key={m} className="tbtn" style={mode === m ? { color: "var(--text)", background: "var(--e2)" } : undefined} onClick={() => setMode(m)}>
          {m === "stage" ? "Stage" : m === "library" ? "Library" : "Automate"}
        </button>
      ))}
    </nav>
  );
}

function NowPlaying() {
  const engine = useStore((s) => s.engine)!;
  const library = useStore((s) => s.library);
  const paused = engine.paused !== "none";

  const screens = [...engine.monitors].sort((a, b) => Number(b.primary) - Number(a.primary)).filter((m) => m.wallpaper);
  const paths = [...new Set(screens.map((m) => m.wallpaper!))];
  const w = library.find((x) => x.path === paths[0]);
  const thumb = useThumb(w);
  const where = screens.filter((m) => m.wallpaper === paths[0]).map((m) => m.name).join(" + ");
  const more = paths.length - 1;
  const tip = !w ? "Nothing playing" : `${w.name} on ${where}${more ? ` (+${more} more)` : ""} · click to ${paused ? "resume" : "pause"} (Space)`;
  return (
    <div className="flex items-center gap-1 h-[32px] pl-[3px] pr-1 mr-2 rounded-[10px]" style={{ background: "var(--e1)", boxShadow: "inset 0 0 0 1px var(--edge)" }}>
      <Tip label={tip}>
        <button
          className="group/np relative w-[46px] h-[26px] rounded-[7px] overflow-hidden disabled:cursor-default"
          style={{ background: "#0b0b0f", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)" }}
          aria-label={paused ? "Resume wallpapers" : "Pause wallpapers"}
          aria-pressed={paused}
          disabled={!w && !paused}
          onClick={() => send(paused ? "Resume" : "Pause")}
        >
          {w && (
            <div className="absolute inset-0 transition-[filter,opacity] duration-300" style={{ filter: paused ? "grayscale(.85) brightness(.55)" : undefined }}>
              <LookLayer path={w.path}>
                <Preview look={w.look} src={thumb} paused={paused} />
              </LookLayer>
            </div>
          )}
          {more > 0 && <span className="absolute right-[3px] top-[2px] mono text-[9px] leading-none px-[3px] py-[1px] rounded-[3px]" style={{ background: "rgba(0,0,0,.55)", color: "var(--text-2)" }}>+{more}</span>}
          <span
            className={`absolute inset-0 grid place-items-center transition-opacity duration-200 ${paused ? "opacity-100" : "opacity-0 group-hover/np:opacity-100"}`}
            style={{ background: paused ? undefined : "rgba(0,0,0,.35)", color: "#fff" }}
          >
            {paused ? <Play size={12} fill="currentColor" /> : <PauseIcon size={12} fill="currentColor" />}
          </span>
        </button>
      </Tip>
      <VolumeLine settings={engine.settings} />
      <Tip label="Next wallpaper (N)">
        <button className="tbtn !h-[26px] !px-1" aria-label="Next wallpaper" disabled={!w} onClick={() => send("Next")}>
          <ChevronRight size={15} />
        </button>
      </Tip>
    </div>
  );
}

function VolumeLine({ settings }: { settings: Settings }) {
  const [local, setLocal] = useState<number | null>(null);
  const [hot, setHot] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const muted = settings.mute;
  const vol = local ?? settings.volume;

  const commit = (v: number, now = false) => {
    clearTimeout(pending.current);
    const go = () => {
      last.current = Date.now();
      send({ SetSettings: { ...useStore.getState().engine!.settings, volume: v, mute: v === 0 } });
    };
    if (now || Date.now() - last.current > 120) go();
    else pending.current = window.setTimeout(go, 120);
  };
  useEffect(() => () => clearTimeout(pending.current), []);
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100);
  };
  const Icon = muted || vol === 0 ? VolumeX : vol < 50 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-1 pl-1">
      <Tip label={muted ? "Turn sound on (M)" : "Mute (M)"}>
        <button className="tbtn !h-[26px] !px-1" aria-label={muted ? "Turn sound on" : "Mute"} aria-pressed={muted} onClick={() => send({ SetSettings: { ...settings, mute: !muted } })}>
          <Icon size={14} />
        </button>
      </Tip>
      <div
        ref={track}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={muted ? 0 : vol}
        tabIndex={0}
        className="relative w-[64px] h-[26px] cursor-pointer outline-none"
        title={muted ? "Muted" : `Volume ${vol}%`}
        onPointerEnter={() => setHot(true)}
        onPointerLeave={() => local === null && setHot(false)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const v = at(e.clientX);
          setLocal(v);
          commit(v);
        }}
        onPointerMove={(e) => {
          if (local === null) return;
          const v = at(e.clientX);
          setLocal(v);
          commit(v);
        }}
        onPointerUp={(e) => {
          if (local === null) return;
          commit(at(e.clientX), true);
          setLocal(null);
          setHot(false);
        }}
        onWheel={(e) => {
          const v = Math.max(0, Math.min(100, (muted ? 0 : settings.volume) + (e.deltaY < 0 ? 5 : -5)));
          commit(v, true);
        }}
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -5 : 0;
          if (step) (e.preventDefault(), commit(Math.max(0, Math.min(100, settings.volume + step)), true));
        }}
      >
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 rounded-full transition-[height] duration-150" style={{ height: hot ? 4 : 2, background: "var(--e3)" }}>
          <div className="absolute left-0 top-0 bottom-0 rounded-full transition-[background] duration-200" style={{ width: `${muted ? 0 : vol}%`, background: muted ? "var(--text-4)" : "var(--text-2)" }} />
        </div>
        <div
          className="absolute top-1/2 w-[10px] h-[10px] -ml-[5px] -mt-[5px] rounded-full transition-opacity duration-150"
          style={{ left: `${muted ? 0 : vol}%`, background: "var(--text)", opacity: hot ? 1 : 0, boxShadow: "0 1px 4px rgba(0,0,0,.5)" }}
        />
      </div>
    </div>
  );
}
