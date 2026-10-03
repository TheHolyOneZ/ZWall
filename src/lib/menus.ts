

import { add, rotationFor, setRotateEvery, TEMPLATES } from "./automations";
import { add as addWidget, KINDS } from "./widgets";
import { place, send } from "./actions";
import { bridge } from "./ipc";
import type { MenuItem } from "./store";
import { useStore } from "./store";
import { addTag, createTag, moveTag, removeTag, renameTag } from "./tags";
import { clearScreen, deleteTagWithUndo, removeWallpapers } from "./undo";
import { addToCollection, askNewCollection, removeFromCollection } from "./collections";
import type { Monitor, Wallpaper } from "./types";

const st = () => useStore.getState();

function askNewTag(then: (tag: string) => void) {
  st().ask({ title: "New tag", value: "", placeholder: "e.g. cosy, cyberpunk, work", confirm: "Create", onConfirm: then });
}


function tagItems(ws: Wallpaper[]): MenuItem[] {
  const lib = st().library;
  const known = [...new Set([...(st().engine?.tag_list ?? []), ...lib.flatMap((w) => w.tags)])].sort();
  return [
    ...known.map((t) => {
      const all = ws.every((w) => w.tags.includes(t));
      return { label: t, checked: all, onSelect: () => (all ? removeTag(ws, t) : addTag(ws, t)) };
    }),
    ...(known.length ? [{ separator: true }] : []),
    { label: "New tag…", onSelect: () => askNewTag((t) => addTag(ws, t)) },
  ];
}

export function wallpaperMenu(ws: Wallpaper[], opts: { viewingTag?: string; viewingCollection?: string } = {}): MenuItem[] {
  if (!ws.length) return [];
  const monitors = st().engine?.monitors ?? [];
  const one = ws.length === 1 ? ws[0] : null;
  const own = ws.filter((w) => w.own && !w.developing);
  const allFav = ws.every((w) => w.fav);
  const lib = st().library;
  const knownTags = [...new Set([...(st().engine?.tag_list ?? []), ...lib.flatMap((w) => w.tags)])].sort();
  const items: MenuItem[] = [];
  if (ws.length > 1) items.push({ heading: true, label: `${ws.length} wallpapers` });
  if (one) {
    items.push({
      label: "Use on",
      submenu: [
        ...monitors.map((m) => ({ label: m.name, checked: m.wallpaper === one.path, onSelect: () => place(one, m.name) })),
        ...(monitors.length > 1 ? [{ separator: true }, { label: "All screens", onSelect: () => place(one, "all") }] : []),
      ],
    });
    items.push({ label: "Settings", onSelect: () => st().inspect(one.id) });
    items.push({ separator: true });
  }
  items.push({ label: allFav ? "Remove from favourites" : "Add to favourites", onSelect: () => ws.forEach((w) => st().setFavourite(w, !allFav)) });
  items.push({ label: "Tags", submenu: tagItems(ws) });

  const cols = st().engine?.collections ?? [];
  items.push({
    label: "Add to collection",
    submenu: [
      ...cols.map((c) => {
        const allIn = ws.every((w) => c.paths.includes(w.path));
        return { label: c.name, checked: allIn, onSelect: () => (allIn ? removeFromCollection(c.id, ws) : addToCollection(c.id, ws)) };
      }),
      ...(cols.length ? [{ separator: true }] : []),
      { label: "New collection…", onSelect: () => askNewCollection(ws) },
    ],
  });
  const viewing = cols.find((c) => c.id === opts.viewingCollection);
  if (viewing) items.push({ label: `Remove from “${viewing.name}”`, onSelect: () => removeFromCollection(viewing.id, ws) });
  if (opts.viewingTag) {
    const others = knownTags.filter((t) => t !== opts.viewingTag);
    items.push({
      label: `Move from “${opts.viewingTag}” to`,
      submenu: [...others.map((t) => ({ label: t, onSelect: () => moveTag(ws, opts.viewingTag!, t) })), ...(others.length ? [{ separator: true }] : []), { label: "New tag…", onSelect: () => askNewTag((t) => moveTag(ws, opts.viewingTag!, t)) }],
    });
  }

  if (own.length) {
    const allLive = own.every((w) => w.alsoLive);
    items.push({ label: "Also list under Live shaders", checked: allLive, onSelect: () => own.forEach((w) => send({ SetAlsoLive: { path: w.path, on: !allLive } })) });
  }
  items.push({ separator: true });
  if (one) items.push({ label: "Share as .zwall", onSelect: () => send({ Export: { path: one.path, name: one.name } }) });
  if (one?.own) items.push({ label: "Show in file manager", onSelect: async () => (await bridge).reveal(one.path) });
  if (own.length) {
    items.push({ separator: true });
    items.push({
      label: own.length === 1 ? "Remove from library" : `Remove ${own.length} from library`,
      hint: "files stay",
      danger: true,
      onSelect: () => removeWallpapers(own),
    });
  }
  return items;
}

export function tagMenu(tag: string, onFilter: () => void): MenuItem[] {
  const count = st().library.filter((w) => w.tags.includes(tag)).length;
  return [
    { label: "Show only this tag", onSelect: onFilter },
    { label: `Select all ${count}`, disabled: !count, onSelect: () => st().select(st().library.filter((w) => w.tags.includes(tag)).map((w) => w.id), null) },
    { separator: true },
    { label: "Rename…", onSelect: () => st().ask({ title: `Rename “${tag}”`, value: tag, confirm: "Rename", onConfirm: (to) => renameTag(tag, to) }) },
    { label: "Delete tag", hint: count ? `from ${count}` : undefined, danger: true, onSelect: () => deleteTagWithUndo(tag) },
  ];
}

export function newTagItem(): MenuItem {
  return { label: "New tag…", onSelect: () => askNewTag((t) => createTag(t)) };
}

export function screenMenu(m: Monitor): MenuItem[] {
  const rot = rotationFor(m.name);
  const every = rot?.enabled && rot.trigger.type === "every" ? rot.trigger.minutes : null;
  const set = (n: number | null) => setRotateEvery(m.name, n);
  const current = st().library.find((w) => w.path === m.wallpaper);
  return [
    { heading: true, label: m.name },
    ...(current ? [{ label: `${current.name} settings`, onSelect: () => st().inspect(current.id) }] : []),
    {
      label: "Rotate",
      submenu: [
        { label: "Off", checked: every === null, onSelect: () => set(null) },
        { label: "Every 15 min", checked: every === 15, onSelect: () => set(15) },
        { label: "Every hour", checked: every === 60, onSelect: () => set(60) },
        { label: "Daily", checked: every === 1440, onSelect: () => set(1440) },
        { separator: true },
        { label: "More options…", onSelect: () => (rot ? st().setFocusAutomation(rot.id) : st().setMode("automate")) },
      ],
    },
    {
      label: "Day & night",
      hint: "07:00 / 19:00",
      onSelect: () => {
        const [first] = add(...TEMPLATES.find((t) => t.id === "daynight")!.make([m.name]));
        st().setFocusAutomation(first);
      },
    },
    ...(st().engine?.backend === "plasma"
      ? [{ label: "Add widget", hint: "clock, date, text…", submenu: KINDS.map(([k, label]) => ({ label, onSelect: () => addWidget(k, m.name) })) }]
      : []),
    { label: "Browse library", onSelect: () => st().setMode("library") },
    { separator: true },
    { label: "Clear", hint: "your own wallpaper returns", disabled: !m.wallpaper, danger: true, onSelect: () => clearScreen(m.name) },
  ];
}
