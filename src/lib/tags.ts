import { send } from "./actions";
import { useStore } from "./store";
import type { Wallpaper } from "./types";

const clean = (t: string) => t.trim().toLowerCase();

function created(): string[] {
  return useStore.getState().engine?.tag_list ?? [];
}

function setTags(w: Wallpaper, tags: string[]) {
  send({ SetTags: { path: w.path, tags } });
}

export function createTag(name: string) {
  const t = clean(name);
  if (t && !created().includes(t)) send({ SetTagList: [...created(), t] });
  return t;
}

export function addTag(ws: Wallpaper[], name: string) {
  const t = createTag(name);
  if (!t) return;
  for (const w of ws) if (!w.tags.includes(t)) setTags(w, [...w.tags, t]);
}

export function removeTag(ws: Wallpaper[], tag: string) {
  for (const w of ws) if (w.tags.includes(tag)) setTags(w, w.tags.filter((x) => x !== tag));
}

export function moveTag(ws: Wallpaper[], from: string, to: string) {
  const t = createTag(to);
  if (!t || t === from) return;
  for (const w of ws) {
    const next = w.tags.filter((x) => x !== from);
    if (!next.includes(t)) next.push(t);
    setTags(w, next);
  }
}

export function renameTag(from: string, to: string) {
  const t = clean(to);
  if (!t || t === from) return;
  const lib = useStore.getState().library;
  for (const w of lib.filter((w) => w.tags.includes(from))) {
    const next = w.tags.map((x) => (x === from ? t : x));
    setTags(w, [...new Set(next)]);
  }
  send({ SetTagList: [...new Set(created().map((x) => (x === from ? t : x)).concat(t))] });
}

export function deleteTag(tag: string) {
  removeTag(useStore.getState().library, tag);
  send({ SetTagList: created().filter((x) => x !== tag) });
}
