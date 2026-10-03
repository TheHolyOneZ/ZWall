

import { KIND_LABEL } from "./presets";
import type { Kind, Wallpaper } from "./types";

export type Sort = "name" | "newest" | "type" | "size";


export type Res = "8k" | "4k" | "1440" | "1080" | "small" | "any" | "screens";
export type Shape = "wide" | "landscape" | "portrait";

export const RES_LABEL: Record<Res, string> = { screens: "Sharp on my screens", "8k": "8K", "4k": "4K", "1440": "1440p", "1080": "1080p", small: "Smaller", any: "Any size" };
export const SHAPE_LABEL: Record<Shape, string> = { wide: "Ultrawide", landscape: "Landscape", portrait: "Portrait" };

export interface Query {
  text: string;
  kind: Kind | "all";
  tags: string[];

  collection: Collection | null;
  res: Res | null;
  shape: Shape | null;
  sort: Sort;
}


export type Collection = "fav" | "screen" | "recent" | `user:${string}` | `watch:${string}`;

export const EMPTY_QUERY: Query = { text: "", kind: "all", tags: [], collection: null, res: null, shape: null, sort: "name" };

const WEEK = 7 * 24 * 3600;


export function inCollection(w: Wallpaper, c: Collection | null, onScreen: Set<string>, users: Record<string, Set<string>> = {}): boolean {
  if (c?.startsWith("user:")) return !!users[c.slice(5)]?.has(w.path);
  if (c?.startsWith("watch:")) return w.fromWatch === c.slice(6);
  if (c === "fav") return !!w.fav;
  if (c === "screen") return onScreen.has(w.path);
  if (c === "recent") return !!w.added && Date.now() / 1000 - w.added < WEEK;
  return true;
}


export function resOf(w: Wallpaper): Exclude<Res, "screens"> {
  if (!w.width || !w.height) return "any";
  const long = Math.max(w.width, w.height);
  return long >= 7680 ? "8k" : long >= 3840 ? "4k" : long >= 2560 ? "1440" : long >= 1920 ? "1080" : "small";
}

export function shapeOf(w: Wallpaper): Shape | null {
  if (!w.width || !w.height) return null;
  const r = w.width / w.height;
  return r >= 2 ? "wide" : r >= 1 ? "landscape" : "portrait";
}


export function inRes(w: Wallpaper, res: Res | null, biggest: [number, number] = [0, 0]): boolean {
  if (!res) return true;
  if (res === "screens") return resOf(w) === "any" || (Math.max(w.width!, w.height!) >= Math.max(...biggest) && Math.min(w.width!, w.height!) >= Math.min(...biggest));
  return resOf(w) === res;
}

function words(w: Wallpaper): string[] {
  return [...w.name.toLowerCase().split(/[\s\-_()]+/), ...(w.fileName && w.fileName !== w.name ? w.fileName.toLowerCase().split(/[\s\-_()]+/) : []), ...(w.meta?.author ?? "").toLowerCase().split(/\s+/), ...w.tags, resOf(w), ...(shapeOf(w) ? [shapeOf(w)!] : []), w.kind, ...KIND_LABEL[w.kind].toLowerCase().split(" "), ...(w.fav ? ["favourite", "favorite"] : [])].filter(Boolean);
}

export function matches(w: Wallpaper, text: string): boolean {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const name = w.name.toLowerCase();
  const ws = words(w);
  return tokens.every((t) => name.includes(t) || ws.some((x) => x.startsWith(t)));
}


export function inKind(w: Wallpaper, kind: Kind | "all"): boolean {
  return kind === "all" || w.kind === kind || (kind === "shader" && !!w.alsoLive);
}

export function run(lib: Wallpaper[], q: Query, onScreen: Set<string> = new Set(), users: Record<string, Set<string>> = {}, biggest: [number, number] = [0, 0]): Wallpaper[] {
  const out = lib.filter(
    (w) =>
      !w.developing &&
      inKind(w, q.kind) &&
      inCollection(w, q.collection, onScreen, users) &&
      inRes(w, q.res, biggest) &&
      (!q.shape || shapeOf(w) === q.shape) &&
      q.tags.every((t) => w.tags.includes(t)) &&
      matches(w, q.text),
  );
  const byName = (a: Wallpaper, b: Wallpaper) => a.name.localeCompare(b.name);
  switch (q.sort) {
    case "newest":
      return out.sort((a, b) => (b.added ?? 0) - (a.added ?? 0) || byName(a, b));
    case "type":
      return out.sort((a, b) => a.kind.localeCompare(b.kind) || byName(a, b));
    case "size":

      return out.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) || byName(a, b));
    default:
      return out.sort(byName);
  }
}


export function allTags(lib: Wallpaper[], created: string[] = []): [string, number][] {
  const counts = new Map<string, number>(created.map((t) => [t, 0]));
  for (const w of lib) for (const t of w.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
