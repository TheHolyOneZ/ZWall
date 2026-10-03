

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Intro, introWanted } from "./components/Intro";
import { DragGhost } from "./components/DragGhost";
import { DropVeil } from "./components/DropVeil";
import { Inspector } from "./components/Inspector";
import { AutomateView } from "./components/AutomateView";
import { WidgetEditor } from "./components/WidgetEditor";
import { WatchDialog } from "./components/WatchDialog";
import { LibraryView } from "./components/LibraryView";
import { ContextMenuHost } from "./components/ui/Menu";
import { PromptDialog } from "./components/ui/PromptDialog";
import { BatchImport } from "./components/BatchImport";
import { TrialBar } from "./components/TrialBar";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsPanel } from "./components/SettingsPanel";
import { Shelf } from "./components/Shelf";
import { Stage } from "./components/Stage";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { send } from "./lib/actions";
import { bridge } from "./lib/ipc";
import "./lib/glass";
import { importPaths } from "./lib/intake";
import { byPath, useStore } from "./lib/store";

export default function App() {
  const mode = useStore((s) => s.mode);
  const inspecting = useStore((s) => (!!s.inspecting && s.library.some((w) => w.id === s.inspecting)) || (!!s.editingWidget && !!s.engine?.widgets.some((w) => w.id === s.editingWidget)));
  const [intro, setIntro] = useState<"playing" | "leaving" | "none">(() => (introWanted() ? "playing" : "none"));
  useEngine();
  useVideoPreviews();
  useCreatorDrops();
  useAmbient();
  useKeys();
  useNoBrowserMenu();
  useMaximizedCorners();

  return (
    <>
      <div className="room" />
      <div className={`h-full ${intro === "playing" ? "app-under-intro" : intro === "leaving" ? "app-after-intro" : ""}`}>
      <motion.main className="relative h-full flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.24 }}>
        <TitleBar />
        {mode === "stage" ? (
          <>

            <div className="flex-1 min-h-0 flex flex-col transition-[padding] duration-300 ease-out" style={{ paddingRight: inspecting ? 340 : 0 }}>
              <Stage />
              <Shelf />
            </div>
            <Inspector />
            <WidgetEditor />
          </>
        ) : mode === "library" ? (
          <LibraryView />
        ) : (
          <AutomateView />
        )}
        <SettingsPanel />
      </motion.main>
      </div>
      {intro !== "none" && <Intro onLeave={() => setIntro("leaving")} />}
      <DragGhost />
      <DropVeil />
      <Toasts />
      <ContextMenuHost />
      <PromptDialog />
      <BatchImport />
      <WatchDialog />
      <TrialBar />
      <CommandPalette />
    </>
  );
}


function useVideoPreviews() {
  const missing = useStore((s) => {
    if (!s.connected || !s.engine) return "";

    const needs = new Set(s.library.filter((w) => w.kind === "video" || w.kind === "web" || w.kind === "photo").map((w) => w.path));
    for (const m of s.engine.monitors) if (m.wallpaper && /\.(mp4|webm|mkv|mov|gif)$/i.test(m.wallpaper)) needs.add(m.wallpaper);
    return [...needs].filter((p) => !s.engine!.thumbs[p]).join("\n");
  });
  useEffect(() => {
    for (const path of missing.split("\n").filter(Boolean)) send({ MakePreview: { path } });
  }, [missing]);
}

function useEngine() {
  useEffect(() => {
    let off: (() => void)[] = [];
    let alive = true;
    (async () => {
      const b = await bridge;

      off = [
        await b.onState((s) => useStore.getState().setEngine(!!s, s)),
        await b.onError((e) => useStore.getState().toast("error", e)),
        await b.onNotice((n) => useStore.getState().toast("ok", n)),
      ];
      const snap = await b.snapshot();
      if (!alive) return;
      if (snap.state || !useStore.getState().connected) useStore.getState().setEngine(snap.connected, snap.state);

      setTimeout(() => alive && useStore.setState({ hydrated: true }), 1500);
    })();
    return () => {
      alive = false;
      off.forEach((f) => f());
    };
  }, []);
}


function useCreatorDrops() {
  useEffect(() => {
    let off = () => {};
    (async () => {
      const b = await bridge;
      off = await b.onFileDrop(async (e) => {
        const { setFileOver } = useStore.getState();
        setFileOver(e.type === "over");
        if (e.type !== "drop") return;
        await importPaths(e.paths);
      });
    })();
    return () => off();
  }, []);
}


function useAmbient() {
  const glow = useStore((s) => {
    const playing = [...(s.engine?.monitors ?? [])].sort((a, b) => +b.primary - +a.primary).filter((m) => m.wallpaper);
    return byPath(s.library, playing[0]?.wallpaper ?? null)?.glow;
  });
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--glow-a", glow?.[0] ?? "#2a2540");
    root.setProperty("--glow-b", glow?.[1] ?? "#1a1f2e");
  }, [glow]);
}


function useMaximizedCorners() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    bridge.then((b) => b.onMaximized((max) => (document.documentElement.dataset.maximized = String(max)))).then((s) => (stop = s));
    return () => stop?.();
  }, []);
}


function useNoBrowserMenu() {
  useEffect(() => {
    const block = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault();
    };
    window.addEventListener("contextmenu", block);
    return () => window.removeEventListener("contextmenu", block);
  }, []);
}

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [role=switch], .card")) return;
      const s = useStore.getState();
      if (e.key === "Escape") (s.inspect(null), s.openSettings(false));
      if ((e.key === "m" || e.key === "M") && s.engine) send({ SetSettings: { ...s.engine.settings, mute: !s.engine.settings.mute } });
      if ((e.key === "n" || e.key === "N") && !e.ctrlKey && s.connected) send("Next");
      if (e.key === "," && e.ctrlKey) (e.preventDefault(), s.openSettings(true));
      if (e.key === " " && s.connected) {
        e.preventDefault();
        send(s.engine?.paused === "none" ? "Pause" : "Resume");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
