import { send } from "./actions";
import { useStore } from "./store";
import type { UserCollection, Wallpaper } from "./types";

const all = (): UserCollection[] => useStore.getState().engine?.collections ?? [];
const save = (cols: UserCollection[]) => send({ SetCollections: cols });

export function createCollection(name: string, ws: Wallpaper[] = []): string {
  const id = Math.random().toString(36).slice(2, 10);
  save([...all(), { id, name: name.trim(), paths: ws.map((w) => w.path) }]);
  return id;
}

export function renameCollection(id: string, name: string) {
  save(all().map((c) => (c.id === id ? { ...c, name: name.trim() } : c)));
}

export function deleteCollection(id: string) {
  const before = all();
  const gone = before.find((c) => c.id === id);
  if (!gone) return;
  save(before.filter((c) => c.id !== id));
  useStore.getState().toast("ok", `Deleted “${gone.name}”`, { label: "Undo", run: () => save(before) });
}

export function addToCollection(id: string, ws: Wallpaper[]) {
  save(all().map((c) => (c.id === id ? { ...c, paths: [...c.paths, ...ws.map((w) => w.path).filter((p) => !c.paths.includes(p))] } : c)));
}

export function removeFromCollection(id: string, ws: Wallpaper[]) {
  const drop = new Set(ws.map((w) => w.path));
  save(all().map((c) => (c.id === id ? { ...c, paths: c.paths.filter((p) => !drop.has(p)) } : c)));
}

export function askNewCollection(ws: Wallpaper[] = []) {
  useStore.getState().ask({
    title: ws.length ? `New collection with ${ws.length === 1 ? ws[0].name : `${ws.length} wallpapers`}` : "New collection",
    value: "",
    placeholder: "e.g. Anime, Calm evenings, Work",
    confirm: "Create",
    onConfirm: (name) => createCollection(name, ws),
  });
}
