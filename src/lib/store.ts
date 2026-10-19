import { create } from "zustand";
import { send } from "./actions";
import { assetUrl as assetUrlOf } from "./ipc";
import { PRESETS } from "./presets";
import type { EngineState, Wallpaper } from "./types";

export interface Toast {
  id: number;
  kind: "ok" | "error";
  text: string;

  action?: { label: string; run(): void };
}

export interface Carry {
  wallpaper: Wallpaper;
  x: number;
  y: number;

  target: string | null;
}

export type Mode = "stage" | "library" | "automate";

export interface MenuItem {
  label?: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;

  heading?: boolean;
  submenu?: MenuItem[];
  onSelect?(): void;
}

export interface Prompt {
  title: string;
  value: string;
  placeholder?: string;
  confirm: string;
  onConfirm(value: string): void;
}

interface Store {
  selected: string[];
  anchor: string | null;
  select(ids: string[], anchor?: string | null): void;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  openMenu(x: number, y: number, items: MenuItem[]): void;
  closeMenu(): void;
  prompt: Prompt | null;

  importing: string | null;

  watchEdit: { id?: string; path?: string } | null;

  editingWidget: string | null;
  editWidget(id: string | null): void;
  editWatch(w: { id?: string; path?: string } | null): void;

  focusAutomation: string | null;

  trial: { monitor: string; name: string; prev: string | null } | null;
  setFocusAutomation(id: string | null): void;
  openImport(dir: string | null): void;
  ask(p: Prompt | null): void;
  mode: Mode;
  setMode(m: Mode): void;

  hydrated: boolean;
  connected: boolean;
  engine: EngineState | null;

  pending: Wallpaper[];

  library: Wallpaper[];
  inspecting: string | null;
  settingsOpen: boolean;
  carry: Carry | null;
  fileOver: boolean;
  toasts: Toast[];
  setEngine(connected: boolean, engine: EngineState | null): void;
  addWallpaper(w: Wallpaper): void;
  finishDeveloping(id: string): void;
  setFavourite(w: Wallpaper, on: boolean): void;
  removeWallpaper(w: Wallpaper): void;
  inspect(id: string | null): void;
  openSettings(open: boolean): void;
  setCarry(c: Carry | null): void;
  setFileOver(v: boolean): void;
  toast(kind: Toast["kind"], text: string, action?: Toast["action"]): void;
  dismissToast(id: number): void;
}

function derive(engine: EngineState | null, pending: Wallpaper[]): Wallpaper[] {
  const favs = new Set(engine?.favourites ?? []);
  const live = new Set(engine?.also_live ?? []);
  const own: Wallpaper[] = (engine?.library ?? [])
    .filter((i) => !pending.some((p) => p.path === i.path))
    .map((i) => ({ id: `own:${i.path}`, path: i.path, name: i.name, kind: i.kind, look: i.kind, glow: ["#c94bff", "#4b7bff"], own: true, tags: [], added: i.added ?? 0, fromWatch: i.from_watch ?? undefined }));
  return [...pending, ...own, ...PRESETS].map((w) => {
    const meta = engine?.meta?.[w.path];
    const facts = engine?.facts?.[w.path];
    const sized = meta?.width && meta?.height ? meta : facts?.width ? facts : undefined;
    return {
      ...w,
      fav: favs.has(w.path),
      alsoLive: live.has(w.path),
      tags: engine?.tags?.[w.path] ?? w.tags ?? [],
      fileName: w.name,
      name: meta?.title || w.name,
      meta,
      width: sized?.width,
      height: sized?.height,
      bytes: facts?.bytes || undefined,
    };
  });
}

const MODE_KEY = "zwall.mode";
function loadMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "library" || m === "automate" ? m : "stage";
  } catch {
    return "stage";
  }
}

let toastId = 0;

export const useStore = create<Store>((set, get) => ({
  selected: [],
  anchor: null,
  select: (selected, anchor) => set((s) => ({ selected, anchor: anchor === undefined ? s.anchor : anchor })),
  menu: null,
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
  prompt: null,
  importing: null,
  watchEdit: null,
  editingWidget: null,
  editWidget: (editingWidget) => set({ editingWidget, ...(editingWidget ? { inspecting: null } : {}) }),
  editWatch: (watchEdit) => set({ watchEdit, menu: null }),
  focusAutomation: null,
  trial: null,
  setFocusAutomation(focusAutomation) {
    set({ focusAutomation, menu: null });
    if (focusAutomation) get().setMode("automate");
  },
  openImport: (importing) => set({ importing, menu: null }),
  ask: (prompt) => set({ prompt, menu: null }),
  mode: loadMode(),
  setMode(mode) {
    set({ mode });
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
    }
  },
  hydrated: false,
  connected: false,
  engine: null,
  pending: [],
  library: derive(null, []),
  inspecting: null,
  settingsOpen: false,
  carry: null,
  fileOver: false,
  toasts: [],
  setEngine: (connected, engine) =>
    set((s) => ({ connected, engine, library: derive(engine, s.pending), ...(connected ? { hydrated: true } : {}) })),
  addWallpaper(w) {
    if (w.developing) {
      set((s) => {
        const pending = [w, ...s.pending.filter((p) => p.path !== w.path)];
        return { pending, library: derive(s.engine, pending) };
      });
    } else if (w.kind !== "shader") {
      send({ AddToLibrary: { path: w.path, name: w.name, kind: w.kind } });
    }
  },
  finishDeveloping(id) {
    const w = get().pending.find((p) => p.id === id);
    if (!w || w.kind === "shader") return;
    send({ AddToLibrary: { path: w.path, name: w.name, kind: w.kind } });

    setTimeout(() => set((s) => {
      const pending = s.pending.filter((p) => p.id !== id);
      return { pending, library: derive(s.engine, pending) };
    }), 300);
    set((s) => {
      const pending = s.pending.map((p) => (p.id === id ? { ...p, developing: false } : p));
      return { pending, library: derive(s.engine, pending) };
    });
  },
  setFavourite: (w, on) => send({ SetFavourite: { path: w.path, on } }),
  removeWallpaper(w) {
    send({ RemoveFromLibrary: { path: w.path } });
    set((s) => ({ inspecting: s.inspecting === w.id ? null : s.inspecting }));
  },

  inspect: (inspecting) => set(inspecting ? { inspecting, settingsOpen: false, editingWidget: null } : { inspecting }),
  openSettings: (settingsOpen) => set(settingsOpen ? { settingsOpen, inspecting: null } : { settingsOpen }),
  setCarry: (carry) => set({ carry }),
  setFileOver: (fileOver) => set({ fileOver }),
  toast(kind, text, action) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 6500 : kind === "error" ? 5200 : 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const byPath = (lib: Wallpaper[], path: string | null) => (path ? lib.find((w) => w.path === path) : undefined);

export function resolve(lib: Wallpaper[], path: string | null): Wallpaper | undefined {
  if (!path) return undefined;
  const known = byPath(lib, path);
  if (known) return known;
  const video = /\.(mp4|webm|mkv|mov|gif)$/i.test(path);
  const web = /\.html?$/i.test(path) || !/\.[a-z0-9]+$/i.test(path);
  return {
    id: `ext:${path}`,
    path,
    name: path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ""),
    kind: web ? "web" : video ? "video" : "photo",
    look: web ? "web" : video ? "video" : "photo",
    glow: ["#c94bff", "#4b7bff"],
    own: true,
    tags: [],
  };
}

export function useThumb(w: Wallpaper | undefined): string | null {
  const thumb = useStore((s) => (w ? s.engine?.thumbs?.[w.path] : undefined));
  if (!w) return null;
  return assetUrlOf(thumb);
}
