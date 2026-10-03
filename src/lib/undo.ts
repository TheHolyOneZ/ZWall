

import { send } from "./actions";
import { useStore } from "./store";
import type { Wallpaper } from "./types";

const st = () => useStore.getState();
const undo = (text: string, run: () => void) => st().toast("ok", text, { label: "Undo", run });


export function removeWallpapers(ws: Wallpaper[]) {
  const e = st().engine;
  if (!e || !ws.length) return;
  const items = e.library.filter((i) => ws.some((w) => w.path === i.path));
  const snapshot = items.map((i) => ({
    item: i,
    tags: e.tags[i.path],
    fav: e.favourites.includes(i.path),
    params: e.params[i.path],
    live: e.also_live.includes(i.path),
  }));
  for (const w of ws) st().removeWallpaper(w);
  st().select([], null);
  undo(ws.length === 1 ? `Removed ${ws[0].name}` : `Removed ${ws.length} wallpapers`, () => {
    for (const s of snapshot) {
      send({ AddToLibrary: s.item });
      if (s.tags) send({ SetTags: { path: s.item.path, tags: s.tags } });
      if (s.fav) send({ SetFavourite: { path: s.item.path, on: true } });
      if (s.params) send({ SetParams: { path: s.item.path, params: s.params } });
      if (s.live) send({ SetAlsoLive: { path: s.item.path, on: true } });
    }
  });
}


function screens(names: string[] | null) {
  return (st().engine?.monitors ?? []).filter((m) => !names || names.includes(m.name)).map((m) => ({ name: m.name, path: m.wallpaper }));
}

function restore(prev: { name: string; path: string | null }[]) {
  for (const p of prev) send(p.path ? { SetWallpaper: { path: p.path, monitors: [p.name] } } : { Clear: { monitor: p.name } });
}

export function clearScreen(monitor: string) {
  const prev = screens([monitor]);
  send({ Clear: { monitor } });
  undo(`Cleared ${monitor}`, () => restore(prev));
}


export function rememberBeforePlacing(target: string): (() => void) | null {
  const names = target === "all" ? null : target.startsWith("span:") ? target.slice(5).split("+") : [target];
  const prev = screens(names);
  if (prev.every((p) => !p.path)) return null;
  return () => restore(prev);
}

export function deleteTagWithUndo(tag: string) {
  const e = st().engine;
  const had = st().library.filter((w) => w.tags.includes(tag)).map((w) => ({ path: w.path, tags: w.tags }));
  const list = e?.tag_list ?? [];
  for (const w of had) send({ SetTags: { path: w.path, tags: w.tags.filter((t) => t !== tag) } });
  send({ SetTagList: list.filter((t) => t !== tag) });
  undo(`Deleted tag “${tag}”`, () => {
    for (const w of had) send({ SetTags: { path: w.path, tags: w.tags } });
    send({ SetTagList: list });
  });
}
