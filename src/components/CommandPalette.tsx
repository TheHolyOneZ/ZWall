

import { add, TEMPLATES, title, update } from "../lib/automations";
import { folderName, startWatching } from "../lib/watches";
import { add as addWidget, KINDS as WIDGET_KINDS } from "../lib/widgets";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { importFolder, importWallpaperEngine, place, send } from "../lib/actions";
import { importFiles } from "../lib/intake";
import { bridge } from "../lib/ipc";
import { useStore } from "../lib/store";
import { clearScreen } from "../lib/undo";

interface Command {
  label: string;
  group: string;
  hint?: string;
  run(): void;
}

function commands(): Command[] {
  const s = useStore.getState();
  const e = s.engine;
  const monitors = e?.monitors ?? [];
  const out: Command[] = [];
  const nav = (label: string, run: () => void, hint?: string) => out.push({ label, group: "Go to", run, hint });
  nav("Stage", () => (s.openSettings(false), s.setMode("stage")));
  nav("Library", () => (s.openSettings(false), s.setMode("library")));
  nav("Settings", () => s.openSettings(true), "Ctrl+,");
  if (e) {
    out.push({ label: e.paused === "none" ? "Pause wallpapers" : "Resume wallpapers", group: "Playback", hint: "Space", run: () => send(e.paused === "none" ? "Pause" : "Resume") });
    out.push({ label: e.settings.mute ? "Turn sound on" : "Mute sound", group: "Playback", hint: "M", run: () => send({ SetSettings: { ...e.settings, mute: !e.settings.mute } }) });
    out.push({ label: "Next wallpaper", group: "Playback", hint: "N", run: () => send("Next") });
  }
  out.push({ label: "Quit ZWall completely", group: "Playback", hint: "wallpapers stop", run: () => {
    send("Quit");
    setTimeout(() => bridge.then((b) => b.quitApp()), 300);
  } });
  out.push({ label: "Add files…", group: "Import", run: importFiles });
  out.push({ label: "Import a folder…", group: "Import", run: importFolder });
  out.push({ label: "Watch a folder…", group: "Import", run: startWatching });
  for (const w of s.engine?.watches ?? []) out.push({ label: `Edit watched folder ${folderName(w.path)}`, group: "Import", run: () => s.editWatch({ id: w.id }) });
  out.push({ label: "Import from Wallpaper Engine…", group: "Import", run: importWallpaperEngine });
  for (const m of monitors) {
    if (m.wallpaper) out.push({ label: `Clear ${m.name}`, group: "Screens", run: () => clearScreen(m.name) });
    out.push({ label: `Day & night on ${m.name}`, group: "Automate", run: () => s.setFocusAutomation(add(...TEMPLATES.find((t) => t.id === "daynight")!.make([m.name]))[0]) });
  }
  out.push({ label: "Open Automate", group: "Automate", run: () => s.setMode("automate") });
  if (s.engine?.backend === "plasma")
    for (const m of monitors) for (const [k, label] of WIDGET_KINDS) out.push({ label: `Add ${label.toLowerCase()} on ${m.name}`, group: "Widgets", run: () => (s.setMode("stage"), addWidget(k, m.name)) });
  for (const t of TEMPLATES) out.push({ label: `New automation: ${t.title}`, group: "Automate", run: () => s.setFocusAutomation(add(...t.make())[0]) });
  for (const a of s.engine?.automations ?? []) {
    out.push({ label: `Run now: ${title(a)}`, group: "Automate", run: () => send({ RunAutomation: { id: a.id } }) });
    out.push({ label: `${a.enabled ? "Turn off" : "Turn on"}: ${title(a)}`, group: "Automate", run: () => update(a.id, { enabled: !a.enabled }) });
  }
  for (const w of s.library.filter((w) => !w.developing)) {
    for (const m of monitors) out.push({ label: `Play ${w.name} on ${m.name}`, group: "Wallpapers", run: () => place(w, m.name) });
    if (monitors.length > 1) out.push({ label: `Play ${w.name} on all screens`, group: "Wallpapers", run: () => place(w, "all") });
    out.push({ label: `${w.name} settings`, group: "Wallpapers", run: () => (s.openSettings(false), s.inspect(w.id)) });
  }
  return out;
}


function score(c: Command, q: string): number {
  const words = c.label.toLowerCase().replace(/-/g, "").split(/[\s·]+/);
  const terms = q.toLowerCase().replace(/-/g, "").split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  let total = 0;
  for (const t of terms) {
    const i = words.findIndex((w) => w.startsWith(t));
    if (i < 0) {
      if (!c.label.toLowerCase().includes(t)) return 0;
      total += 1;
    } else total += 3 - Math.min(2, i * 0.2);
  }
  return total;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return <AnimatePresence>{open && <Palette close={() => setOpen(false)} />}</AnimatePresence>;
}

function Palette({ close }: { close(): void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const all = useMemo(commands, []);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const scored = all.map((c) => [c, score(c, q)] as const).filter(([, s]) => s > 0);

    const base = q ? scored.sort((a, b) => b[1] - a[1]) : scored.filter(([c]) => c.group !== "Wallpapers");
    return base.slice(0, 60).map(([c]) => c);
  }, [all, q]);
  useEffect(() => {
    setAt(0);
  }, [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const run = (c?: Command) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <motion.div className="fixed inset-0 flex justify-center items-start pt-[14vh]" style={{ zIndex: 95, background: "rgba(5,5,8,.22)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <motion.div className="glass-3 w-[560px] max-w-[calc(100vw-32px)] rounded-[14px] overflow-hidden" initial={{ y: -8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 460, damping: 36 }}>
        <div className="flex items-center gap-2.5 px-4 h-[50px] border-b" style={{ borderColor: "var(--edge)" }}>
          <Search size={16} style={{ color: "var(--text-3)" }} />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none text-[15px]"
            style={{ color: "var(--text)" }}
            placeholder="Play, find, go to… (e.g. “lava dp-3”)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setAt((i) => Math.min(shown.length - 1, i + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setAt((i) => Math.max(0, i - 1)));
              else if (e.key === "Enter") (e.preventDefault(), run(shown[at]));
              else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), close());
            }}
          />
          <kbd className="text-[11px] px-1.5 h-[20px] inline-flex items-center rounded-[5px]" style={{ background: "var(--e2)", color: "var(--text-3)" }}>Esc</kbd>
        </div>
        <div ref={list} className="max-h-[52vh] overflow-y-auto p-1.5">
          {shown.length === 0 && <div className="px-3 py-6 text-center text-[13px]" style={{ color: "var(--text-3)" }}>Nothing for “{q}”.</div>}
          {shown.map((c, i) => {
            const head = i === 0 || shown[i - 1].group !== c.group;
            return (
              <div key={c.group + c.label}>
                {head && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--text-4)" }}>{c.group}</div>}
                <button
                  data-i={i}
                  className="w-full flex items-center justify-between gap-3 h-[34px] px-2.5 rounded-[8px] text-left text-[13px]"
                  style={{ background: i === at ? "var(--e3)" : undefined, color: i === at ? "var(--text)" : "var(--text-2)" }}
                  onPointerMove={() => setAt(i)}
                  onClick={() => run(c)}
                >
                  <span className="truncate">{c.label}</span>
                  {i === at ? <CornerDownLeft size={13} style={{ color: "var(--text-3)" }} /> : c.hint && <span className="text-[11px]" style={{ color: "var(--text-4)" }}>{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
