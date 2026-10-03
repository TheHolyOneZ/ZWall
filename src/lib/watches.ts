

import { send } from "./actions";
import { bridge } from "./ipc";
import { useStore } from "./store";
import type { Watch } from "./types";

export const all = (): Watch[] => useStore.getState().engine?.watches ?? [];
export const save = (list: Watch[]) => send({ SetWatches: list });

export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

export function blankWatch(path: string): Watch {
  return { id: Math.random().toString(36).slice(2, 10), path, enabled: true, recursive: true, kinds: [], collection: null, tags: [], prune: true, ignored: [] };
}


export async function startWatching() {
  const dir = await (await bridge).pickFolder("Watch a folder for new wallpapers");
  if (!dir) return;
  const existing = all().find((w) => w.path === dir);
  useStore.getState().editWatch(existing ? { id: existing.id } : { path: dir });
}

export function upsert(w: Watch) {
  const list = all();
  save(list.some((x) => x.id === w.id) ? list.map((x) => (x.id === w.id ? w : x)) : [...list, w]);
}

export function setEnabled(id: string, enabled: boolean) {
  save(all().map((w) => (w.id === id ? { ...w, enabled } : w)));
}


export function stopWatching(id: string, removeWallpapers: boolean) {
  const st = useStore.getState();
  const w = all().find((x) => x.id === id);
  if (!w) return;
  const from = st.library.filter((x) => x.fromWatch === id);
  save(all().filter((x) => x.id !== id));
  if (removeWallpapers) for (const x of from) send({ RemoveFromLibrary: { path: x.path } });
  st.toast("ok", removeWallpapers ? `Stopped watching ${folderName(w.path)} and removed its ${from.length} wallpapers` : `Stopped watching ${folderName(w.path)}. Its wallpapers stay in your library.`);
}
