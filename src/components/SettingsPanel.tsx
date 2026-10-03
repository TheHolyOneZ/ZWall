

import { introEnabled, setIntroEnabled } from "./Intro";
import { AnimatePresence, motion } from "motion/react";
import { AppWindow, Blend, ExternalLink, Gauge, Hand, Headphones, History, Info, Keyboard, Layers, Lock, Maximize, Moon, MousePointerClick, Palette, Power, Search, Settings2, Sparkles, Sunrise, Tv, Volume2, X } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { send } from "../lib/actions";
import { bridge } from "../lib/ipc";
import { useStore } from "../lib/store";
import type { Settings } from "../lib/types";
import { Switch } from "./ui/Switch";
import { setGlass } from "../lib/glass";


const Query = createContext("");

function useMatch(...texts: (string | undefined)[]) {
  const q = useContext(Query).trim().toLowerCase();
  if (!q) return true;
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

const SECTIONS = [
  ["general", "General", Settings2],
  ["performance", "Performance", Gauge],
  ["pause", "Pause automatically", Moon],
  ["look", "Look", Sunrise],
  ["sound", "Sound", Volume2],
  ["interaction", "Interaction", Hand],
  ["about", "About", Info],
] as const;

export function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.engine?.settings);
  return (
    <AnimatePresence>
      {open && settings && (

        <motion.div
          key="settings"
          className="fixed inset-0 grid place-items-center p-6"
          style={{ zIndex: 40, background: "rgba(5,5,8,.22)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          onPointerDown={(e) => e.target === e.currentTarget && useStore.getState().openSettings(false)}
        >
          <motion.div
            role="dialog"
            aria-label="Settings"
            className="glass-3 w-[min(1000px,100%)] h-[min(720px,100%)] rounded-[16px] flex overflow-hidden"
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <Page s={settings} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Page({ s }: { s: Settings }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>("general");


  const pinned = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);


  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (pinned.current) return;
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.replace("settings-", ""));
      },
      { root, rootMargin: "0px 0px -60% 0px" },
    );
    root.querySelectorAll("section[id^=settings-]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [query]);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "f" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !(e.target as HTMLElement).closest("input"))) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (id: string) => {
    setActive(id);
    pinned.current = true;
    setQuery("");
    requestAnimationFrame(() => scroller.current?.querySelector(`#settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <Query.Provider value={query}>

      <nav className="w-[220px] shrink-0 flex flex-col p-3 border-r" style={{ borderColor: "var(--edge)" }}>
        <div className="flex items-center justify-between px-2 pt-1 pb-3">
          <div className="text-[20px] font-semibold tracking-[-0.02em]">Settings</div>
        </div>
        <div className="relative mb-3">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          <input
            ref={search}
            className="w-full h-[32px] pl-8 pr-7 rounded-[8px] text-[13px] outline-none"
            style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
            placeholder="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))}
          />
          {query && (
            <button className="tbtn absolute right-1 top-1/2 -translate-y-1/2 !h-[24px] !px-1.5" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={12} />
            </button>
          )}
        </div>
        {SECTIONS.map(([id, label, Icon]) => {
          const on = !query && active === id;
          return (
            <button key={id} className="relative flex items-center gap-2.5 h-[32px] px-2 rounded-[8px] text-[13px] text-left transition-colors hover:bg-[var(--e1)]" style={{ color: on ? "var(--text)" : "var(--text-2)" }} onClick={() => go(id)}>
              {on && <motion.span layoutId="settings-nav" className="absolute inset-0 rounded-[8px]" style={{ background: "var(--e3)" }} transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <Icon size={15} className="relative" />
              <span className="relative">{label}</span>
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="px-2 text-[12px] leading-[1.45]" style={{ color: "var(--text-4)" }}>
          Changes apply right away. Esc closes.
        </div>
      </nav>


      <div className="relative flex-1 min-w-0 flex flex-col">
        <button className="btn icon-btn absolute top-3 right-3 z-10" onClick={() => useStore.getState().openSettings(false)} title="Close (Esc)" aria-label="Close settings">
          <X size={14} />
        </button>
        <div
          ref={scroller}
          className="scroll-fade flex-1 overflow-y-auto px-8 pt-6 pb-16"
          onWheel={() => (pinned.current = false)}
          onPointerDown={() => (pinned.current = false)}
          onTouchMove={() => (pinned.current = false)}
          onKeyDown={(e) => ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(e.key) && (pinned.current = false)}
        >
          <div className="max-w-[640px] mx-auto flex flex-col gap-8">
            <Sections s={s} />
            <div className="settings-empty text-[13px] text-center py-16" style={{ color: "var(--text-3)" }}>
              Nothing in Settings matches “{query}”.
            </div>
          </div>
        </div>
      </div>
    </Query.Provider>
  );
}

function Sections({ s }: { s: Settings }) {
  const engine = useStore((st) => st.engine);
  const set = (patch: Partial<Settings>) => send({ SetSettings: { ...s, ...patch } });
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    bridge.then((b) => b.autostart()).then(setAutostart, () => setAutostart(false));
  }, []);
  const toggleAutostart = async (on: boolean) => {
    setAutostart(on);
    try {
      setAutostart(await (await bridge).setAutostart(on));
    } catch (e) {
      setAutostart(!on);
      useStore.getState().toast("error", String(e));
    }
  };

  return (
    <>
      <Section id="general" title="General">
        <Toggle icon={<Power size={14} />} label="Start with your computer" hint="ZWall starts quietly at login (just the wallpapers, not this window)." on={!!autostart} onChange={toggleAutostart} />
        <Toggle
          icon={<History size={14} />}
          label="Pick up where you left off"
          hint="Each screen comes back with what it was playing, with all its settings. Off: ZWall starts with your own wallpapers showing."
          on={s.resume}
          onChange={(resume) => set({ resume })}
        />
      </Section>

      <Section id="performance" title="Performance">
        <Row label="Frame rate" hint="Shaders and photos. Videos keep their own rate." keywords="fps hz smooth">
          <Choice value={s.fps_cap} options={[[15, "15"], [30, "30"], [60, "60"], [144, "144"]]} onChange={(fps_cap) => set({ fps_cap })} />
        </Row>
        {(engine?.backend === "plasma" || engine?.backend === "mock") && <Row label="Web pages frame rate" hint="HTML wallpapers are drawn by a browser, which costs far more per frame than a shader. Most pages look the same at 30 or 60. Never above the frame rate above." keywords="fps html web gpu browser">
          <Choice value={s.web_fps ?? 30} options={[[30, "30"], [60, "60"], [0, "Same"]]} onChange={(web_fps) => set({ web_fps })} />
        </Row>}
        <Row label="Render quality" hint="Lower draws fewer pixels and upscales: less GPU, softer picture. Applies to shaders, photos and web pages." keywords="resolution gpu">
          <Choice value={s.quality} options={[[0.5, "50%"], [0.75, "75%"], [1, "Full"]]} onChange={(quality) => set({ quality })} />
        </Row>
      </Section>

      <Section id="pause" title="Pause automatically">
        <Toggle icon={<Maximize size={14} />} label="When an app is fullscreen" hint="Games and videos get the whole GPU." on={s.pause_fullscreen} onChange={(pause_fullscreen) => set({ pause_fullscreen })} />
        <Row label="When windows cover a screen" hint="Nobody sees a covered wallpaper, so it can rest. See-through windows don't count. Only that screen is affected." keywords="covered maximised">
          <Choice value={s.when_covered === "keep" ? 0 : s.when_covered === "calm" ? 1 : 2} options={[[0, "Keep playing"], [1, "Calm down"], [2, "Pause it"]]} onChange={(v) => set({ when_covered: (["keep", "calm", "pause"] as const)[v] })} />
        </Row>
        <Row label="On battery" hint="Only matters on laptops. Saving power means 30 FPS and half resolution." keywords="laptop power">
          <Choice value={s.pause_battery ? 0 : s.battery_saver ? 1 : 2} options={[[0, "Pause"], [1, "Save power"], [2, "Keep going"]]} onChange={(v) => set({ pause_battery: v === 0, battery_saver: v === 1 })} />
        </Row>
        <Row label="When you're away" hint="No keyboard or mouse for this long. Moving the mouse resumes instantly." keywords="idle afk">
          <Choice value={s.pause_idle_minutes} options={[[0, "Never"], [5, "5 min"], [10, "10 min"], [30, "30 min"]]} onChange={(pause_idle_minutes) => set({ pause_idle_minutes })} />
        </Row>
        <Toggle icon={<Lock size={14} />} label="While the screen is locked" hint="Nobody's looking, so nothing renders." on={s.pause_locked} onChange={(pause_locked) => set({ pause_locked })} />
        <Apps apps={s.pause_apps} onChange={(pause_apps) => set({ pause_apps })} />
      </Section>

      <Section id="look" title="Look">
        {(engine?.backend === "plasma" || engine?.backend === "mock") && (engine?.monitors.length ?? 0) > 1 && <Toggle
          icon={<Blend size={14} />}
          label="Blend screens where they meet"
          hint="Two screens with different wallpapers share their colours along the edge where they touch, so it looks like one desk. This is the default for each pair; fine-tune each seam on the Stage (drag its lines and dots, scroll the pill for strength)."
          on={s.blend_edges}
          onChange={(blend_edges) => set({ blend_edges })}
        />}
        {s.blend_edges && (engine?.backend === "plasma" || engine?.backend === "mock") && (
          <Row label="Blend strength and reach" hint="Defaults for seams you haven't adjusted on the Stage." keywords="blend seam edge monitors">
            <div className="flex gap-2">
              <Choice value={s.blend_strength} options={[[0.4, "Subtle"], [0.7, "Medium"], [0.95, "Strong"]]} onChange={(blend_strength) => set({ blend_strength })} />
              <Choice value={s.blend_width} options={[[0.08, "Narrow"], [0.12, "Wide"], [0.2, "Far"]]} onChange={(blend_width) => set({ blend_width })} />
            </div>
          </Row>
        )}
        <Toggle icon={<Sunrise size={14} />} label="Follow the time of day" hint="Every wallpaper warms at dawn and dusk and dims into cool blue at night." on={s.follow_daylight} onChange={(follow_daylight) => set({ follow_daylight })} />
        {engine?.backend === "plasma" && (
          <Toggle
            icon={<Palette size={14} />}
            label="Accent colour from the wallpaper"
            hint="Your desktop's accent follows what plays on the primary screen. Turning this off brings your own accent back."
            on={s.match_accent}
            onChange={(match_accent) => set({ match_accent })}
          />
        )}
        <GlassToggle />
        <IntroToggle />
        <Row label="Screensaver" icon={<Tv size={14} />} hint="After this long without input, your wallpapers play full screen. Any key or mouse movement ends it. Videos you watch in a browser keep it away." keywords="idle">
          <Choice value={s.screensaver_minutes} options={[[0, "Off"], [5, "5 min"], [15, "15 min"], [30, "30 min"]]} onChange={(screensaver_minutes) => set({ screensaver_minutes })} />
        </Row>
      </Section>

      <Section id="sound" title="Sound">
        <Toggle icon={<Volume2 size={14} />} label="Play video sound" hint="Press M anywhere in ZWall to toggle." on={!s.mute} onChange={(on) => set({ mute: !on })} />
        <Toggle icon={<Headphones size={14} />} label="Quiet when other apps play sound" hint="Music, a video or a game takes over; wallpaper sound comes back when they stop." on={s.duck_audio} onChange={(duck_audio) => set({ duck_audio })} />
        <Volume value={s.volume} disabled={s.mute} onChange={(volume) => set({ volume })} />
      </Section>

      <Section id="interaction" title="Interaction">
        <Toggle icon={<MousePointerClick size={14} />} label="Ripples when you click the desktop" hint="Shaders and photos. Your icons and desktop menu keep working." on={s.interactive} onChange={(interactive) => set({ interactive })} />
        <Toggle
          icon={<Keyboard size={14} />}
          label="Keyboard shortcuts everywhere"
          hint={
            s.hotkeys && engine?.shortcuts.length
              ? `${engine.shortcuts.join(", ")}. They work even with this window closed.`
              : engine?.backend === "hyprland" || engine?.backend === "layershell"
                ? "Your compositor owns shortcuts. Add to its config, e.g. Hyprland: bind = SUPER ALT, P, exec, zwall-engine ctl pause (also mute, next)."
                : "Pause, mute and next wallpaper from anywhere, even with this window closed."
          }
          on={s.hotkeys}
          onChange={(hotkeys) => set({ hotkeys })}
        />
      </Section>

      <Section id="about" title="About">
        <About />
      </Section>
    </>
  );
}


function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} className="settings-section scroll-mt-4">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] mb-3" style={{ color: "var(--text)" }}>{title}</h2>
      <div className="rounded-[12px] px-4" style={{ background: "var(--e1)", border: "1px solid var(--edge)" }}>
        {children}
      </div>
    </section>
  );
}


function Row({ label, hint, icon, keywords, children }: { label: string; hint?: string; icon?: ReactNode; keywords?: string; children: ReactNode }) {
  if (!useMatch(label, hint, keywords)) return null;
  return (
    <div data-setting className="settings-row flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
      <div className="min-w-[200px] flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: "var(--text)" }}>
          {icon && <span style={{ color: "var(--text-3)" }}>{icon}</span>}
          {label}
        </div>
        {hint && <div className="text-[12px] mt-0.5 leading-[1.45]" style={{ color: "var(--text-3)" }}>{hint}</div>}
      </div>
      <div className="w-[300px] max-w-full">{children}</div>
    </div>
  );
}

function Choice<T extends number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void }) {
  const id = options.map((o) => o[1]).join();
  return (
    <div className="flex p-[3px] rounded-[10px]" style={{ background: "var(--e1)", border: "1px solid var(--edge)" }}>
      {options.map(([v, text]) => {
        const on = Math.abs(v - value) < 0.001;
        return (
          <button key={text} className="relative flex-1 h-[26px] text-[12px] font-medium focusable rounded-[7px]" style={{ color: on ? "var(--text)" : "var(--text-3)" }} onClick={() => onChange(v)}>
            {on && <motion.span layoutId={`choice-${id}`} className="absolute inset-0 rounded-[7px]" style={{ background: "var(--e4)", boxShadow: "inset 0 1px 0 var(--edge-top)" }} transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
            <span className="relative">{text}</span>
          </button>
        );
      })}
    </div>
  );
}


export function Toggle({ icon, label, hint, on, onChange }: { icon?: ReactNode; label: string; hint?: string; on: boolean; onChange(v: boolean): void }) {
  if (!useMatch(label, hint)) return null;
  return (
    <label data-setting className="settings-row flex items-start justify-between gap-4 cursor-pointer py-3.5">
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: "var(--text)" }}>
          {icon && <span style={{ color: "var(--text-3)" }}>{icon}</span>}
          {label}
        </span>
        {hint && <span className="block text-[12px] mt-0.5 leading-[1.45]" style={{ color: "var(--text-3)" }}>{hint}</span>}
      </span>
      <span className="mt-0.5">
        <Switch label={label} on={on} onChange={onChange} />
      </span>
    </label>
  );
}

function Volume({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(v: number): void }) {
  if (!useMatch("Master volume sound loud")) return null;
  return (
    <div data-setting className="settings-row py-3.5" style={{ opacity: disabled ? 0.45 : 1, transition: "opacity .18s" }}>
      <div className="flex justify-between text-[13px] mb-2">
        <span className="font-medium" style={{ color: "var(--text)" }}>Master volume</span>
        <span className="num text-[12px]" style={{ color: "var(--text-3)" }}>{value}%</span>
      </div>
      <div className="relative h-[22px]">
        <div className="absolute inset-x-0 top-[10px] h-[2px] rounded-[1px]" style={{ background: "var(--e4)" }} />
        <div className="absolute left-0 top-[10px] h-[2px] rounded-[1px]" style={{ width: `${value}%`, background: "var(--accent)" }} />
        <div className="absolute top-[4px] w-[14px] h-[14px] rounded-[5px] -ml-[7px] pointer-events-none" style={{ left: `${value}%`, background: "var(--accent)", boxShadow: "0 1px 3px rgba(0,0,0,.5)" }} />
        <input type="range" aria-label="Master volume" disabled={disabled} className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed" min={0} max={100} value={value} onChange={(e) => onChange(+e.target.value)} />
      </div>
    </div>
  );
}


function Apps({ apps, onChange }: { apps: string[]; onChange(apps: string[]): void }) {
  const [draft, setDraft] = useState("");
  if (!useMatch("While these programs run apps games obs steam process", apps.join(" "))) return null;
  const add = () => {
    const name = draft.trim();
    if (name && !apps.some((a) => a.toLowerCase() === name.toLowerCase())) onChange([...apps, name]);
    setDraft("");
  };
  return (
    <div data-setting className="settings-row py-3.5">
      <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: "var(--text)" }}>
        <span style={{ color: "var(--text-3)" }}><AppWindow size={14} /></span> While these programs run
      </div>
      <div className="text-[12px] mt-0.5 mb-2.5 leading-[1.45]" style={{ color: "var(--text-3)" }}>Matches the start of the process name, so “steam” also covers Steam's helpers.</div>
      {apps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {apps.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 h-[24px] pl-2 pr-1 rounded-[6px] text-[12px]" style={{ background: "var(--e2)" }}>
              {a}
              <button className="tbtn !h-[18px] !px-1" aria-label={`Remove ${a}`} onClick={() => onChange(apps.filter((x) => x !== a))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form className="flex gap-1.5" onSubmit={(e) => (e.preventDefault(), add())}>
        <input
          className="flex-1 h-[30px] px-2.5 rounded-[7px] text-[13px] outline-none"
          style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
          placeholder="Program name, e.g. obs or steam"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn !h-[30px]" type="submit" disabled={!draft.trim()}>Add</button>
      </form>
    </div>
  );
}

const LINKS: [string, string, string][] = [
  ["Project homepage", "zsync.eu/zwall", "https://zsync.eu/zwall/"],
  ["Source code", "github.com/TheHolyOneZ/ZWall", "https://github.com/TheHolyOneZ/ZWall"],
  ["TheHolyOneZ", "github.com/TheHolyOneZ", "https://github.com/TheHolyOneZ"],
  ["More projects", "zsync.eu", "https://zsync.eu"],
  ["Game modes", "zlogic.eu", "https://zlogic.eu"],
];

const STACK: [string, [string, string][]][] = [
  ["App", [["Tauri 2", "native window, tray, system access"], ["React 19 + TypeScript 5.9", "the interface"], ["Tailwind CSS 4", "styling"], ["Motion 13", "springs and transitions"], ["Zustand 5", "app state"], ["Vite 8", "build"]]],
  ["Engine", [["Rust", "the zwall-engine background service"], ["wgpu 30", "live shaders and photo parallax on the GPU"], ["libmpv", "hardware-decoded video"], ["ONNX Runtime + Depth Anything V2", "3D depth from a photo, on your computer"], ["JSON over a local socket", "how the app talks to the engine"]]],
  ["Desktop", [["KDE Plasma plugin (QML, Qt Quick, Qt WebEngine)", "wallpapers and web pages inside Plasma"], ["X11 (x11rb) and Wayland layer-shell", "other Linux desktops"], ["GNOME Shell extension", "GNOME"], ["WorkerW desktop layer", "Windows 10 and 11"]]],
];

function About() {
  const engine = useStore((st) => st.engine);
  const connected = useStore((st) => st.connected);
  if (!useMatch("About engine desktop gpu screens version made by TheHolyOneZ licence github source homepage zsync zlogic tech stack rust tauri react wgpu")) return null;
  const row = (k: string, v: ReactNode) => (
    <div className="flex justify-between gap-6 py-[7px] text-[13px] border-b last:border-b-0" style={{ borderColor: "var(--edge)" }}>
      <span style={{ color: "var(--text-3)" }}>{k}</span>
      <span className="text-right truncate" style={{ color: "var(--text-2)" }}>{v}</span>
    </div>
  );
  const open = (url: string) => bridge.then((b) => b.openLink(url));
  const backend: Record<string, string> = { plasma: "KDE Plasma (plugin)", kwin: "KDE Plasma Wayland", x11: "X11 desktop window", layershell: "Wayland layer-shell", gnome: "GNOME", windows: "Windows (WorkerW)" };
  return (
    <div data-setting className="py-2 flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <img src="/icon-64.png" width={56} height={56} alt="" className="rounded-[13px]" draggable={false} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-semibold tracking-[-0.01em]">ZWall</span>
            <span className="mono text-[12px]" style={{ color: "var(--text-3)" }}>v{__APP_VERSION__}</span>
          </div>
          <div className="text-[13px] mt-0.5" style={{ color: "var(--text-2)" }}>
            Live wallpapers for Linux and Windows. Free and open source.
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>
            Made by <button className="underline-offset-2 hover:underline" style={{ color: "var(--text)" }} onClick={() => open("https://github.com/TheHolyOneZ")}>TheHolyOneZ</button> · part of <button className="underline-offset-2 hover:underline" style={{ color: "var(--text)" }} onClick={() => open("https://zsync.eu")}>zsync.eu</button>
          </div>
        </div>
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {LINKS.map(([label, shown, url]) => (
          <button key={url} className="group flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-left transition-colors hover:bg-[var(--e2)]" style={{ background: "var(--e1)", boxShadow: "inset 0 0 0 1px var(--edge)" }} onClick={() => open(url)} title={url}>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium" style={{ color: "var(--text)" }}>{label}</span>
              <span className="block text-[11px] truncate" style={{ color: "var(--text-3)" }}>{shown}</span>
            </span>
            <ExternalLink size={13} className="shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.07em] mb-1" style={{ color: "var(--text-3)" }}>This computer</div>
        {row("Engine", connected ? `running · protocol ${engine?.protocol ?? "?"}` : "not running")}
        {row("Desktop", backend[engine?.backend ?? ""] ?? engine?.backend ?? "?")}
        {row("Graphics", engine?.gpu ?? "starting…")}
        {engine?.gpu_percent != null && row("GPU use", <>{engine.gpu_percent.toFixed(1)}% <span style={{ color: "var(--text-4)" }}>{engine.backend === "plasma" ? "· whole Plasma desktop, web pages included" : "· wallpaper engine"}</span></>)}
        {row("Screens", engine?.monitors.map((m) => `${m.name} ${m.width}×${m.height}`).join(", ") || "none")}
        {row("Library", `${engine?.library.length ?? 0} of your own · ${engine?.collections.length ?? 0} collections · ${engine?.automations.length ?? 0} automations`)}
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.07em] mb-2" style={{ color: "var(--text-3)" }}>Built with</div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {STACK.map(([layer, items]) => (
            <div key={layer} className="rounded-[10px] p-3" style={{ background: "var(--e1)", boxShadow: "inset 0 0 0 1px var(--edge)" }}>
              <div className="text-[12px] font-semibold mb-1.5" style={{ color: "var(--text-2)" }}>{layer}</div>
              {items.map(([name, what]) => (
                <div key={name} className="text-[12px] leading-[1.45] py-[3px]">
                  <span style={{ color: "var(--text)" }}>{name}</span>
                  <span style={{ color: "var(--text-3)" }}> · {what}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="text-[12px] leading-[1.55]" style={{ color: "var(--text-3)" }}>
        ZWall is free software under the GNU GPL v3 (or later): use it, study it, change it and share it. No accounts, no tracking, no telemetry. The depth model (Depth Anything V2 Small, Apache-2.0) is downloaded once, the first time you use depth.
      </div>
    </div>
  );
}

function IntroToggle() {
  const [on, setOn] = useState(introEnabled);
  return (
    <Toggle
      icon={<Sparkles size={14} />}
      label="Intro when ZWall opens"
      hint="A three-second opening each time the app starts. Click or press any key to skip it."
      on={on}
      onChange={(v) => {
        setOn(v);
        setIntroEnabled(v);
      }}
    />
  );
}

function GlassToggle() {
  const [on, setOn] = useState(() => document.documentElement.dataset.glass !== "off");
  return (
    <Toggle
      icon={<Layers size={14} />}
      label="See-through effects"
      hint="Menus, dialogs and the ZWall window show a frosted view of what's behind them (the window where your system can blur it). Turn off for solid panels on slower computers."
      on={on}
      onChange={(v) => {
        setOn(v);
        setGlass(v);
      }}
    />
  );
}
