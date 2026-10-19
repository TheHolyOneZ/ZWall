import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { pairs as deskPairs } from "./desk";
import type { EngineState, LibraryItem, Request } from "./types";

export interface Found {
  path: string;
  name: string;
  kind: "photo" | "video" | "web" | "zwall" | "scene";

  folder: string;
  bytes: number;

  tags?: string[];

  skip?: string | null;
  source?: "wallpaper-engine" | null;
}

export const inTauri = "__TAURI_INTERNALS__" in window;

export const assetUrl = (path: string | undefined | null) => (path && inTauri ? convertFileSrc(path) : null);

type Listener = (s: EngineState | null) => void;

export interface Bridge {
  snapshot(): Promise<{ connected: boolean; state: EngineState | null }>;
  send(req: Request): Promise<void>;
  wake(): Promise<void>;
  classify(path: string): Promise<"parallax" | "video" | "shader" | "web" | "zwall" | "folder" | "unsupported">;
  autostart(): Promise<boolean>;
  reveal(path: string): Promise<void>;
  openLink(url: string): Promise<void>;
  scanFolder(dir: string, recursive: boolean): Promise<Found[]>;

  pickFolder(title?: string): Promise<string | null>;

  pickFiles(): Promise<string[]>;

  wallpaperEngineFolder(): Promise<string | null>;

  windowGlass(): Promise<boolean>;
  quitApp(): Promise<void>;
  setAutostart(on: boolean): Promise<boolean>;
  onState(fn: Listener): Promise<() => void>;
  onError(fn: (msg: string) => void): Promise<() => void>;
  onNotice(fn: (msg: string) => void): Promise<() => void>;
  onFileDrop(fn: (e: { type: "over" | "leave" | "drop"; paths: string[] }) => void): Promise<() => void>;
  window: { minimize(): void; toggleMaximize(): void; hide(): void; startDragging(): void };

  onMaximized(fn: (max: boolean) => void): Promise<() => void>;
}

async function tauriBridge(): Promise<Bridge> {
  const win = getCurrentWindow();
  return {
    snapshot: () => invoke("snapshot"),
    send: (req) => invoke("send", { req }),
    wake: () => invoke("wake_engine"),
    classify: (path) => invoke("classify", { path }),
    autostart: () => invoke("autostart"),
    reveal: (path) => invoke("reveal", { path }),
    openLink: (url) => invoke("open_link", { url }),
    scanFolder: (dir, recursive) => invoke("scan_folder", { dir, recursive }),
    pickFolder: async (title = "Import wallpapers from a folder") => {
      const r = await openDialog({ directory: true, title });
      return typeof r === "string" ? r : null;
    },
    wallpaperEngineFolder: () => invoke("wallpaper_engine_folder"),
    windowGlass: () => invoke("window_glass"),
    quitApp: () => invoke("quit_app"),
    pickFiles: async () => {
      const r = await openDialog({
        multiple: true,
        title: "Add wallpapers",
        filters: [{ name: "Wallpapers", extensions: ["jpg", "jpeg", "png", "webp", "avif", "mp4", "webm", "mkv", "mov", "gif", "html", "htm", "zwall"] }],
      });
      return Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    },
    setAutostart: (on) => invoke("set_autostart", { on }),
    async onState(fn) {
      const a = await listen<EngineState>("zwall://state", (e) => fn(e.payload));
      const b = await listen<boolean>("zwall://connection", (e) => !e.payload && fn(null));
      return () => (a(), b());
    },
    onError: (fn) => listen<string>("zwall://error", (e) => fn(e.payload)),
    onNotice: (fn) => listen<string>("zwall://notice", (e) => fn(e.payload)),
    onFileDrop: (fn) =>
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") fn({ type: "over", paths: "paths" in p ? p.paths : [] });
        else if (p.type === "drop") fn({ type: "drop", paths: p.paths });
        else fn({ type: "leave", paths: [] });
      }),
    window: {
      minimize: () => void win.minimize(),
      toggleMaximize: () => void win.toggleMaximize(),
      hide: () => void win.hide(),
      startDragging: () => void win.startDragging(),
    },
    onMaximized: async (fn) => {
      const check = async () => fn(await win.isMaximized());
      await check();
      return win.onResized(() => void check());
    },
  };
}

function mockBridge(): Bridge {
  const state: EngineState = {
    protocol: 1,
    backend: "mock",
    paused: "none",
    settings: { fps_cap: 60, web_fps: 30, blend_edges: false, blend_strength: 0.7, blend_width: 0.12, quality: 1, pause_fullscreen: true, pause_battery: true, pause_idle_minutes: 10, volume: 50, mute: false, interactive: true, pause_apps: [], hotkeys: true, when_covered: "pause", battery_saver: true, follow_daylight: false, match_accent: false, screensaver_minutes: 0, resume: true, pause_locked: true, duck_audio: true },
    gpu: "Mock GPU",
    gpu_percent: 2,
    params: {},
    accent: "#ab47bc",
    thumbs: {},

    library: [
      { path: "/mock/city-night.jpg", name: "city-night", kind: "photo", added: 1759400000 },
      { path: "/mock/forest-portrait.jpg", name: "forest-portrait", kind: "photo", added: 1759300000 },
      { path: "/mock/waves.mp4", name: "waves", kind: "video", added: 1759200000 },
    ],
    favourites: [],
    tags: {},
    tag_list: [],
    arrangement: {},
    widgets: [],
    fonts: ["Inter", "JetBrains Mono", "Noto Serif", "DejaVu Sans", "Liberation Serif", "Cantarell"],
    blend_links: {},
    blend_pairs: [],
    blends: {},
    watches: [],
    watch_status: {},
    automations: [],
    manual: {},
    automation_runs: {},
    collections: [],
    meta: {},
    facts: {
      "/mock/city-night.jpg": { width: 5120, height: 2880, bytes: 4_800_000 },
      "/mock/forest-portrait.jpg": { width: 1440, height: 2560, bytes: 1_900_000 },
      "/mock/waves.mp4": { width: 1920, height: 1080, bytes: 38_000_000 },
    },
    also_live: [],
    resting: {},
    durations: {},
    depths: {},
    scenes: {},
    jobs: {},
    shortcuts: ["Super+Alt+P · pause", "Super+Alt+M · mute", "Super+Alt+N · next wallpaper"],
    monitors: [
      { name: "DP-1", x: 0, y: 0, width: 2560, height: 1440, scale: 1, primary: true, wallpaper: "preset://aurora", span: null },
      { name: "DP-3", x: 2560, y: 0, width: 2560, height: 1440, scale: 1, primary: false, wallpaper: null, span: null },
    ],
  };
  const listeners = new Set<Listener>();
  const emit = () => {
    state.blend_pairs = deskPairs(state);
    listeners.forEach((l) => l(structuredClone(state)));
  };
  return {
    snapshot: async () => ({ connected: true, state: structuredClone(state) }),
    async send(req) {
      if (req === "Pause") state.paused = "user";
      if (req === "ClearManual") state.manual = {};
      else if (req === "Resume") state.paused = "none";
      else if (typeof req === "object") {
        const breakSpans = (names: string[]) => {
          const groups = state.monitors.filter((m) => names.includes(m.name) && m.span).map((m) => m.span);
          state.monitors.forEach((m) => groups.includes(m.span) && (m.span = null));
        };
        if ("SetWallpaper" in req) {
          const { path, monitors } = req.SetWallpaper;
          const targets = state.monitors.map((m) => m.name).filter((n) => !monitors.length || monitors.includes(n));
          breakSpans(targets);
          state.monitors.forEach((m) => targets.includes(m.name) && (m.wallpaper = path));
        } else if ("Span" in req) {
          const { path, monitors } = req.Span;
          breakSpans(monitors);
          state.monitors.forEach((m) => monitors.includes(m.name) && ((m.wallpaper = path), (m.span = monitors.join("+"))));
        } else if ("AddToLibrary" in req) {
          state.library = [req.AddToLibrary, ...state.library.filter((i) => i.path !== req.AddToLibrary.path)];
        } else if ("RemoveFromLibrary" in req) {
          state.library = state.library.filter((i) => i.path !== req.RemoveFromLibrary.path);
        } else if ("SetFavourite" in req) {
          const { path, on } = req.SetFavourite;
          state.favourites = [...state.favourites.filter((p) => p !== path), ...(on ? [path] : [])];
        } else if ("SetTags" in req) {
          state.tags[req.SetTags.path] = req.SetTags.tags;
        } else if ("SetTagList" in req) {
          state.tag_list = req.SetTagList;
        } else if ("SetAlsoLive" in req) {
          const { path, on } = req.SetAlsoLive;
          state.also_live = [...state.also_live.filter((p) => p !== path), ...(on ? [path] : [])];
        } else if ("SetArrangement" in req) {
          state.arrangement = req.SetArrangement;
        } else if ("SetWidgets" in req) {
          state.widgets = req.SetWidgets;
        } else if ("SetBlendLinks" in req) {
          state.blend_links = req.SetBlendLinks;
        } else if ("SetWatches" in req) {
          for (const w of req.SetWatches.filter((w) => !state.watches.some((x) => x.id === w.id))) {
            const all: LibraryItem[] = [
              { path: `${w.path}/clips/ocean 4k.mp4`, name: "ocean 4k", kind: "video" },
              { path: `${w.path}/photos/alps 2024.jpg`, name: "alps 2024", kind: "photo" },
              { path: `${w.path}/Rain City/index.html`, name: "Rain City", kind: "web" },
            ];
            const demo = all.filter((d) => !w.kinds.length || w.kinds.includes(d.kind));
            for (const d of demo) state.library = [{ ...d, added: Math.floor(Date.now() / 1000), from_watch: w.id }, ...state.library];
            state.watch_status[w.id] = { found: demo.length, scanned: Math.floor(Date.now() / 1000) };
            const col = w.collection ? state.collections.find((c) => c.id === w.collection) : undefined;
            if (col) col.paths.push(...demo.map((d) => d.path));
          }
          state.watches = req.SetWatches;
        } else if ("SetAutomations" in req) {
          state.automations = req.SetAutomations;
        } else if ("RunAutomation" in req) {
          state.automation_runs[req.RunAutomation.id] = Math.floor(Date.now() / 1000);
        } else if ("SetMeta" in req) {
          const { path, meta } = req.SetMeta;
          const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== "" && v !== 0));
          if (Object.keys(clean).length) state.meta[path] = clean;
          else delete state.meta[path];
        } else if ("SetCollections" in req) {
          state.collections = req.SetCollections;
        } else if ("ClearParams" in req) {
          delete state.params[req.ClearParams.path];
        } else if ("SetSettings" in req) {
          state.settings = req.SetSettings;
        } else if ("SetParams" in req) {
          state.params[req.SetParams.path] = req.SetParams.params;
        } else if ("Clear" in req) {
          breakSpans([req.Clear.monitor]);
          state.monitors.forEach((m) => m.name === req.Clear.monitor && (m.wallpaper = null));
        }
      }
      emit();
    },
    wake: async () => {},
    autostart: async () => false,
    reveal: async () => {},
    openLink: async (url) => void window.open(url, "_blank"),
    scanFolder: async () => [
      { path: "/demo/Rain City/index.html", name: "Rain City", kind: "web", folder: "", bytes: 0 },
      { path: "/demo/clips/ocean 4k.mp4", name: "ocean 4k", kind: "video", folder: "clips", bytes: 81_000_000 },
      { path: "/demo/clips/forest.mkv", name: "forest", kind: "video", folder: "clips", bytes: 120_000_000 },
      { path: "/demo/photos/alps 2024.jpg", name: "alps 2024", kind: "photo", folder: "photos", bytes: 4_000_000 },
    ],
    pickFolder: async () => "/demo",
    pickFiles: async () => [],
    wallpaperEngineFolder: async () => null,
    windowGlass: async () => false,
    quitApp: async () => {},
    setAutostart: async (on) => on,
    classify: async (p) => (/\.(mp4|webm|mkv|mov|gif)$/i.test(p) ? "video" : /\.(jpe?g|png|webp)$/i.test(p) ? "parallax" : "unsupported"),
    async onState(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onError: async () => () => {},
    onNotice: async () => () => {},
    async onFileDrop(fn) {
      const over = (e: DragEvent) => (e.preventDefault(), fn({ type: "over", paths: [] }));
      const leave = (e: DragEvent) => !e.relatedTarget && fn({ type: "leave", paths: [] });
      const drop = (e: DragEvent) => {
        e.preventDefault();
        fn({ type: "drop", paths: [...(e.dataTransfer?.files ?? [])].map((f) => f.name) });
      };
      window.addEventListener("dragover", over);
      window.addEventListener("dragleave", leave);
      window.addEventListener("drop", drop);
      return () => {
        window.removeEventListener("dragover", over);
        window.removeEventListener("dragleave", leave);
        window.removeEventListener("drop", drop);
      };
    },
    window: { minimize() {}, toggleMaximize() {}, hide() {}, startDragging() {} },
    onMaximized: async () => () => {},
  };
}

export const bridge: Promise<Bridge> = inTauri ? tauriBridge() : Promise.resolve(mockBridge());
