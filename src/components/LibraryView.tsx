import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Clock, EyeOff, FolderSync, FolderX, Film, FolderHeart, FolderInput, Globe, Heart, ImageIcon, LayoutGrid, MonitorPlay, Plus, Repeat, Search, Sparkles, Tag as TagIcon, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { importFolder, importWallpaperEngine, place, send } from "../lib/actions";
import { newTagItem, tagMenu, wallpaperMenu } from "../lib/menus";
import { KIND_LABEL } from "../lib/presets";
import { allTags, EMPTY_QUERY, inCollection, inKind, inRes, RES_LABEL, resOf, run, SHAPE_LABEL, shapeOf, type Collection, type Query, type Res, type Shape, type Sort } from "../lib/search";
import { useReorder } from "../lib/reorder";
import { bridge } from "../lib/ipc";
import { folderName, setEnabled as setWatchEnabled, startWatching, stopWatching } from "../lib/watches";
import { useStore, useThumb } from "../lib/store";
import { addTag, moveTag } from "../lib/tags";
import type { Kind, UserCollection, Wallpaper } from "../lib/types";
import { InspectorBody } from "./Inspector";
import { importFiles } from "../lib/intake";
import { removeWallpapers } from "../lib/undo";
import { addToCollection, askNewCollection, deleteCollection, renameCollection } from "../lib/collections";
import type { MenuItem } from "../lib/store";
import { rotateThrough } from "../lib/automations";
import { LookLayer, Preview } from "./Preview";
import { contextMenu } from "./ui/Menu";
import { Dropdown } from "./ui/Dropdown";

const DISPLAY_KEY = "zwall.library.display";

type DropTarget = { kind: "tag"; tag: string } | { kind: "fav" } | { kind: "live" } | { kind: "col"; id: string };

export function LibraryView() {
  const library = useStore((s) => s.library);
  const monitorList = useStore((s) => s.engine?.monitors);
  const created = useStore((s) => s.engine?.tag_list);
  const selectedIds = useStore((s) => s.selected);
  const monitors = monitorList ?? [];
  const [q, setQ] = useState<Query>(EMPTY_QUERY);
  const [display, setDisplayState] = useState<string>(() => {
    try {
      return localStorage.getItem(DISPLAY_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [drag, setDrag] = useState<{ x: number; y: number; ws: Wallpaper[]; over: DropTarget | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [narrow, setNarrow] = useState(() => window.innerWidth < 1000);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 1000);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const colsState = useStore((s) => s.engine?.collections);
  const cols = colsState ?? [];
  const users = useMemo(() => Object.fromEntries((colsState ?? []).map((c) => [c.id, new Set(c.paths)])), [colsState]);
  const onScreen = useMemo(() => new Set((monitorList ?? []).map((m) => m.wallpaper ?? "").filter(Boolean)), [monitorList]);

  const biggest = useMemo<[number, number]>(() => (monitorList ?? []).reduce<[number, number]>((b, m) => (m.width * m.height > b[0] * b[1] ? [m.width, m.height] : b), [0, 0]), [monitorList]);
  const shown = useMemo(() => run(library, q, onScreen, users, biggest), [library, q, onScreen, users, biggest]);
  const tags = useMemo(() => allTags(library, created ?? []), [library, created]);
  const selected = library.filter((w) => selectedIds.includes(w.id));
  const target = monitors.some((m) => m.name === display) || display === "all" ? display : (monitors.find((m) => m.primary)?.name ?? monitors[0]?.name ?? "");
  const viewingTag = q.tags.length === 1 ? q.tags[0] : undefined;
  const setDisplay = (d: string) => {
    setDisplayState(d);
    try {
      localStorage.setItem(DISPLAY_KEY, d);
    } catch {
    }
  };
  const { select, inspect } = useStore.getState();

  useEffect(() => {
    if (selected.length === 1) inspect(selected[0].id);
  }, [selectedIds.join()]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea");
      if ((e.key === "/" && !typing) || (e.key === "f" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (!typing && e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        select(shown.map((w) => w.id), null);
      } else if (!typing && e.key === "Escape") {
        select([], null);
      } else if (!typing && e.key === "Enter" && selected.length === 1 && target) {
        place(selected[0], target);
      } else if (!typing && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) && shown.length) {
        e.preventDefault();
        const cols = gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns.split(" ").length : 1;
        const at = selected.length ? shown.findIndex((w) => w.id === selected[selected.length - 1].id) : -1;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, Home: -Infinity, End: Infinity }[e.key]!;
        const next = at < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, at + step));
        select([shown[next].id], shown[next].id);
        gridRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
      } else if (!typing && e.key === "Delete" && selected.some((w) => w.own)) {
        removeWallpapers(selected.filter((w) => w.own));
      } else if (!typing && (e.key === "f" || e.key === "F") && !e.ctrlKey && selected.length) {
        const all = selected.every((w) => w.fav);
        selected.forEach((w) => useStore.getState().setFavourite(w, !all));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const clickTile = (w: Wallpaper, e: React.MouseEvent) => {
    const { selected: cur, anchor } = useStore.getState();
    if (e.shiftKey && anchor) {
      const a = shown.findIndex((x) => x.id === anchor);
      const b = shown.findIndex((x) => x.id === w.id);
      if (a >= 0 && b >= 0) {
        const range = shown.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id);
        return select(e.ctrlKey || e.metaKey ? [...new Set([...cur, ...range])] : range);
      }
    }
    if (e.ctrlKey || e.metaKey) return select(cur.includes(w.id) ? cur.filter((id) => id !== w.id) : [...cur, w.id], w.id);
    select([w.id], w.id);
  };

  const menuFor = (w: Wallpaper, e: React.MouseEvent) => {
    const cur = useStore.getState().selected;
    const ws = cur.includes(w.id) ? library.filter((x) => cur.includes(x.id)) : [w];
    if (!cur.includes(w.id)) select([w.id], w.id);
    contextMenu(e, wallpaperMenu(ws, { viewingTag, viewingCollection: q.collection?.startsWith("user:") ? q.collection.slice(5) : undefined }));
  };

  const startDrag = (w: Wallpaper, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const cur = useStore.getState().selected;
    const ws = cur.includes(w.id) ? library.filter((x) => cur.includes(x.id)) : [w];
    const hit = (x: number, y: number): DropTarget | null => {
      const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
      if (!el) return null;
      const [kind, tag] = el.dataset.drop!.split(":", 2);
      return kind === "tag" ? { kind: "tag", tag } : kind === "col" ? { kind: "col", id: tag } : kind === "fav" ? { kind: "fav" } : { kind: "live" };
    };
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      dragging = true;
      setDrag({ x: ev.clientX, y: ev.clientY, ws, over: hit(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragging) return;
      const t = hit(ev.clientX, ev.clientY);
      setDrag(null);
      if (!t) return;
      if (t.kind === "tag") viewingTag && viewingTag !== t.tag ? moveTag(ws, viewingTag, t.tag) : addTag(ws, t.tag);
      else if (t.kind === "col") addToCollection(t.id, ws);
      else if (t.kind === "fav") ws.forEach((x) => useStore.getState().setFavourite(x, true));
      else ws.filter((x) => x.own).forEach((x) => send({ SetAlsoLive: { path: x.path, on: true } }));

      const colName = t.kind === "col" ? (useStore.getState().engine?.collections.find((c) => c.id === t.id)?.name ?? "collection") : "";
      const where = t.kind === "tag" ? `“${t.tag}”` : t.kind === "col" ? `“${colName}”` : t.kind === "fav" ? "Favourites" : "Live shaders";
      useStore.getState().toast("ok", `${ws.length === 1 ? ws[0].name : `${ws.length} wallpapers`} → ${where}`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const counts = (k: Kind | "all") => library.filter((w) => !w.developing && inKind(w, k)).length;
  const filtered = q.text || q.kind !== "all" || q.tags.length || q.collection || q.res || q.shape;
  const dropLabel = (t: DropTarget | null) =>
    !t ? "Drop on a tag, a collection or Live shaders" : t.kind === "col" ? `Add to “${cols.find((c) => c.id === t.id)?.name ?? "collection"}”` : t.kind === "tag" ? (viewingTag && viewingTag !== t.tag ? `Move to “${t.tag}”` : `Tag “${t.tag}”`) : t.kind === "fav" ? "Add to Favourites" : "Also list under Live shaders";

  return (
    <motion.div className="flex-1 min-h-0 flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>

      <div className="flex items-center gap-3 px-4 pb-3">
        <div className="relative flex-1 max-w-[520px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          <input
            ref={searchRef}
            className="w-full h-[32px] pl-8 pr-8 rounded-[8px] text-[13px] outline-none"
            style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
            placeholder={narrow ? "Search" : `Search ${counts("all")} wallpapers by name or tag`}
            value={q.text}
            onChange={(e) => setQ({ ...q, text: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && (setQ({ ...q, text: "" }), (e.target as HTMLInputElement).blur())}
          />
          {q.text && (
            <button className="tbtn absolute right-1 top-1/2 -translate-y-1/2 !h-[24px] !px-1.5" aria-label="Clear search" onClick={() => setQ({ ...q, text: "" })}>
              <X size={13} />
            </button>
          )}
        </div>
        <Dropdown<Sort>
          label="Sort"
          value={q.sort}
          width={120}
          options={[
            ["name", "Sort: Name"],
            ["newest", "Sort: Newest"],
            ["type", "Sort: Type"],
            ["size", "Sort: Size"],
          ]}
          onChange={(sort) => setQ({ ...q, sort })}
        />
        <button
          className="btn"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            useStore.getState().openMenu(r.left, r.bottom + 4, [
              { label: "Files…", hint: "photos, videos, pages", onSelect: importFiles },
              { label: "Folder…", hint: "pick what to bring in", onSelect: importFolder },
              { label: "Watch a folder…", hint: "new files come in by themselves", onSelect: startWatching },
              { separator: true },
              { label: "From Wallpaper Engine…", hint: "video & web", onSelect: importWallpaperEngine },
            ]);
          }}
        >
          <FolderInput size={13} /> Import
          <ChevronDown size={13} style={{ color: "var(--text-3)" }} />
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-[12px]" style={{ color: "var(--text-3)" }}>
          Apply to
          {[...monitors.map((m) => m.name), "all"].map((d) => (
            <button key={d} className="tbtn !h-[26px]" style={target === d ? { color: "var(--text)", background: "var(--e3)" } : undefined} onClick={() => setDisplay(d)}>
              {d === "all" ? "All screens" : d}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex">

        <Sidebar
          q={q}
          setQ={setQ}
          counts={counts}
          collectionCount={(c) => library.filter((w) => !w.developing && inCollection(w, c, onScreen, users)).length}
          sizeCount={(f) => library.filter((w) => !w.developing && (!f.res || inRes(w, f.res, biggest)) && (!f.shape || shapeOf(w) === f.shape)).length}
          screens={monitors.length > 0}
          tags={tags}
          over={drag?.over ?? null}
          filtered={!!filtered}
          compact={narrow}
          cols={cols}
        />


        <div
          className="scroll-fade flex-1 min-w-0 overflow-y-auto px-2 pb-6"
          onClick={(e) => e.target === e.currentTarget && select([], null)}
          onContextMenu={(e) =>
            contextMenu(e, [
              { label: "Add files…", onSelect: importFiles },
              { label: "Import folder…", onSelect: importFolder },
              { separator: true },
              { label: `Select all ${shown.length}`, onSelect: () => select(shown.map((w) => w.id), null) },
              { label: "Select none", disabled: !selectedIds.length, onSelect: () => select([], null) },
              { separator: true },
              { label: "Sort by", submenu: (["name", "newest", "type", "size"] as Sort[]).map((s) => ({ label: s[0].toUpperCase() + s.slice(1), checked: q.sort === s, onSelect: () => setQ({ ...q, sort: s }) })) },
              ...(filtered ? [{ label: "Clear filters", onSelect: () => setQ({ ...EMPTY_QUERY, sort: q.sort }) }] : []),
            ])
          }
        >
          {shown.length === 0 ? (
            <div className="h-full flex flex-col">
            <ActiveFilters q={q} setQ={setQ} count={0} />
            <div className="flex-1 grid place-items-center text-[13px] text-center" style={{ color: "var(--text-3)" }}>
              <div>
                Nothing matches these filters.
                <button className="tbtn ml-1 underline-offset-2 hover:underline" onClick={() => setQ({ ...EMPTY_QUERY, sort: q.sort })}>
                  Clear filters
                </button>
              </div>
            </div>
            </div>
          ) : (
            <>
            {filtered ? (
              <ActiveFilters q={q} setQ={setQ} count={shown.length} />
            ) : (
              <div className="h-[24px] mb-1 px-0.5 text-[12px] leading-[24px] truncate" style={{ color: "var(--text-4)" }}>
                {target ? `Double-click to play on ${target === "all" ? "all screens" : target}` : "Click for settings"} · Ctrl or Shift-click to pick several · Right-click for more
              </div>
            )}
            <div ref={gridRef} className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }} onClick={(e) => e.target === e.currentTarget && select([], null)}>
              <AnimatePresence mode="popLayout">
                {shown.map((w) => (
                  <Tile
                    key={w.id}
                    w={w}
                    selected={selectedIds.includes(w.id)}
                    onClick={(e) => clickTile(w, e)}
                    onApply={() => target && place(w, target)}
                    onMenu={(e) => menuFor(w, e)}
                    onDragStart={(e) => startDrag(w, e)}
                  />
                ))}
              </AnimatePresence>
            </div>
            </>
          )}
        </div>


        <AnimatePresence initial={false}>
          {selected.length > 0 && (
            <motion.aside
              className={`w-[320px] shrink-0 border-l flex flex-col min-h-0 overflow-hidden ${narrow ? "absolute right-0 top-0 bottom-0 z-20" : ""}`}
              style={{ borderColor: "var(--edge)", background: narrow ? "var(--panel)" : undefined, boxShadow: narrow ? "-24px 0 48px rgba(0,0,0,.45)" : undefined }}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
            >
              <div className="w-[320px] flex-1 min-h-0 flex flex-col">
                {selected.length === 1 ? <InspectorBody key={selected[0].id} w={selected[0]} /> : <Bulk ws={selected} viewingTag={viewingTag} />}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>


      {drag && (
        <div className="fixed pointer-events-none" style={{ left: drag.x + 12, top: drag.y + 12, zIndex: 70 }}>
          <div className="glass-3 rounded-[9px] px-2.5 py-1.5 text-[12px]">
            <span className="font-medium">{drag.ws.length === 1 ? drag.ws[0].name : `${drag.ws.length} wallpapers`}</span>
            <span style={{ color: drag.over ? "var(--text)" : "var(--text-3)" }}> · {dropLabel(drag.over)}</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

const TYPES: [Kind | "all", string, typeof LayoutGrid][] = [
  ["all", "Everything", LayoutGrid],
  ["shader", "Live shaders", Sparkles],
  ["photo", "Photos", ImageIcon],
  ["video", "Videos", Film],
  ["web", "Web pages", Globe],
];
const COLLECTIONS: [Collection, string, typeof Heart][] = [
  ["fav", "Favourites", Heart],
  ["screen", "On a screen", MonitorPlay],
  ["recent", "Recently added", Clock],
];

const TOP_TAGS = 16;

interface SidebarPrefs {
  folded: string[];

  hidden: string[];
  order: { groups?: string[]; type?: string[]; collections?: string[] };
}
const NO_PREFS: SidebarPrefs = { folded: [], hidden: [], order: {} };
function useSidebarPrefs(): [SidebarPrefs, (p: SidebarPrefs) => void] {
  const [prefs, setPrefs] = useState<SidebarPrefs>(() => {
    try {
      return { ...NO_PREFS, ...JSON.parse(localStorage.getItem("zwall.sidebar") ?? "{}") };
    } catch {
      return NO_PREFS;
    }
  });
  const save = (p: SidebarPrefs) => {
    setPrefs(p);
    try {
      localStorage.setItem("zwall.sidebar", JSON.stringify(p));
    } catch {
    }
  };
  return [prefs, save];
}

function ordered(keys: string[], saved: string[] | undefined): string[] {
  if (!saved?.length) return keys;
  return [...saved.filter((k) => keys.includes(k)), ...keys.filter((k) => !saved.includes(k))];
}

const GROUPS: [string, string][] = [
  ["type", "Type"],
  ["collections", "Collections"],
  ["folders", "Folders"],
  ["size", "Size"],
  ["tags", "Tags"],
];

function userCollectionMenu(c: UserCollection, show: () => void, hide: () => void): MenuItem[] {
  const st = useStore.getState();
  const ms = st.engine?.monitors ?? [];
  const inIt = st.library.filter((w) => c.paths.includes(w.path));
  return [
    { label: "Show it", onSelect: show },
    { label: `Select all ${inIt.length}`, disabled: !inIt.length, onSelect: () => st.select(inIt.map((w) => w.id), null) },
    { label: "Rotate through it on", disabled: !inIt.length || !ms.length, submenu: ms.map((m) => ({ label: m.name, onSelect: () => rotateThrough(m.name, inIt.map((w) => w.path), c.name) })) },
    { separator: true },
    { label: "Rename…", onSelect: () => st.ask({ title: `Rename “${c.name}”`, value: c.name, confirm: "Rename", onConfirm: (n) => renameCollection(c.id, n) }) },
    { label: "Hide from sidebar", hint: "or drag it out", onSelect: hide },
    { separator: true },
    { label: "Delete collection", hint: "wallpapers stay", danger: true, onSelect: () => deleteCollection(c.id) },
  ];
}

function Sidebar({ q, setQ, counts, collectionCount, sizeCount, tags, over, filtered, compact, cols, screens }: {
  q: Query;
  setQ(q: Query): void;
  counts(k: Kind | "all"): number;
  collectionCount(c: Collection): number;
  sizeCount(f: { res?: Res; shape?: Shape }): number;
  tags: [string, number][];
  over: DropTarget | null;
  filtered: boolean;
  compact?: boolean;
  cols: UserCollection[];
  screens: boolean;
}) {
  const [allTags, setAllTags] = useState(false);
  const [prefs, setPrefs] = useSidebarPrefs();
  const asideRef = useRef<HTMLElement>(null);
  const bounds = () => asideRef.current?.getBoundingClientRect() ?? null;
  const isHidden = (id: string) => prefs.hidden.includes(id);
  const hide = (id: string, on: boolean) => setPrefs({ ...prefs, hidden: on ? [...new Set([...prefs.hidden, id])] : prefs.hidden.filter((x) => x !== id) });
  const fold = (id: string) => setPrefs({ ...prefs, folded: prefs.folded.includes(id) ? prefs.folded.filter((x) => x !== id) : [...prefs.folded, id] });
  const setOrder = (list: keyof SidebarPrefs["order"], keys: string[]) => setPrefs({ ...prefs, order: { ...prefs.order, [list]: keys } });
  const userKey = (c: UserCollection): Collection => `user:${c.id}`;
  const watchList = useStore((st) => st.engine?.watches) ?? [];
  const watchStatus = useStore((st) => st.engine?.watch_status) ?? {};
  const label = (id: string) =>
    id.startsWith("group:") ? GROUPS.find(([g]) => g === id.slice(6))?.[1] : id.startsWith("type:") ? TYPES.find(([k]) => k === id.slice(5))?.[1] : id.startsWith("user:") ? cols.find((c) => userKey(c) === id)?.name : COLLECTIONS.find(([c]) => c === id)?.[1];
  const hideWithUndo = (id: string) => {
    hide(id, true);
    useStore.getState().toast("ok", `Hid “${label(id) ?? "it"}”. Right-click the sidebar to bring it back.`);
  };

  const typeKeys = ordered(TYPES.map(([k]) => k), prefs.order.type).filter((k) => !isHidden(`type:${k}`));
  const colKeys = ordered([...COLLECTIONS.map(([c]) => c as string), ...cols.map(userKey)], prefs.order.collections).filter((k) => !isHidden(k));
  const groupKeys = ordered(GROUPS.map(([g]) => g), prefs.order.groups).filter((g) => !isHidden(`group:${g}`));
  const groups = useReorder(groupKeys, { onOrder: (k) => setOrder("groups", k), onOut: (g) => hideWithUndo(`group:${g}`), bounds });
  const types = useReorder(typeKeys, { onOrder: (k) => setOrder("type", k), canOut: (k) => k !== "all", onOut: (k) => hideWithUndo(`type:${k}`), bounds });
  const colls = useReorder(colKeys, {
    onOrder: (k) => {
      setOrder("collections", k);

      const byKey = new Map(cols.map((c) => [userKey(c) as string, c]));
      send({ SetCollections: [...k.filter((x) => byKey.has(x)).map((x) => byKey.get(x)!), ...cols.filter((c) => !k.includes(userKey(c)))] });
    },
    onOut: hideWithUndo,
    bounds,
  });
  const out = [groups, types, colls].map((r) => r.drag).find((d) => d?.out);

  if (compact) return <CompactSidebar q={q} setQ={setQ} counts={counts} collectionCount={collectionCount} tags={tags} over={over} cols={cols} typeKeys={typeKeys} colKeys={colKeys} />;

  const check = (id: string, text?: string): MenuItem => ({ label: text ?? label(id) ?? id, checked: !isHidden(id), onSelect: () => hide(id, !isHidden(id)) });

  const sidebarMenu: MenuItem[] = [
    { label: "New collection…", onSelect: () => askNewCollection() },
    newTagItem(),
    { separator: true },
    { heading: true, label: "Show" },
    { label: "Sections", submenu: GROUPS.map(([g]) => check(`group:${g}`)) },
    { label: "Types", submenu: TYPES.filter(([k]) => k !== "all").map(([k]) => check(`type:${k}`)) },
    { label: "Collections", submenu: [...COLLECTIONS.map(([c]) => check(c)), ...(cols.length ? [{ separator: true } as MenuItem] : []), ...cols.map((c) => check(userKey(c)))] },
    { separator: true },
    { label: "Reset sidebar", hint: "order and hidden", disabled: !prefs.hidden.length && !Object.keys(prefs.order).length && !prefs.folded.length, onSelect: () => setPrefs(NO_PREFS) },
  ];

  const visible = allTags ? tags : tags.slice(0, TOP_TAGS);

  const extra = allTags ? [] : tags.slice(TOP_TAGS).filter(([t]) => q.tags.includes(t));
  const chip = (key: string, text: string, n: number, on: boolean, onClick: () => void, hot = false, rest: Partial<React.ButtonHTMLAttributes<HTMLButtonElement>> & { "data-drop"?: string } = {}) => (
    <button
      key={key}
      {...rest}
      className="inline-flex items-center gap-1 h-[24px] pl-2 pr-1.5 rounded-[7px] text-[12px] transition-colors"
      style={{
        background: on ? "var(--accent)" : hot ? "var(--e4)" : "var(--e2)",
        color: on ? "var(--accent-ink)" : "var(--text-2)",
        boxShadow: hot ? "inset 0 0 0 1px var(--accent)" : undefined,
      }}
      onClick={onClick}
    >
      {text}
      <span className="mono text-[11px]" style={{ opacity: 0.6 }}>{n}</span>
    </button>
  );

  const section = (g: string) => {
    const common = { item: groups.item(g), grip: groups.grip(g), folded: prefs.folded.includes(g), onFold: () => fold(g), onHide: () => hideWithUndo(`group:${g}`) };
    if (g === "type")
      return (
        <Group key={g} {...common} label="Type" listRef={types.listRef}>
          {typeKeys.map((k) => {
            const [, text, Icon] = TYPES.find(([x]) => x === k)!;
            return (
              <NavRow
                key={k}
                {...types.item(k)}
                {...types.grip(k)}
                group="type"
                icon={Icon}
                on={q.kind === k}
                count={counts(k as Kind | "all")}
                drop={k === "shader" ? "live" : undefined}
                over={over?.kind === "live" && k === "shader"}
                onClick={() => setQ({ ...q, kind: k as Kind | "all" })}
                onContextMenu={(e) => contextMenu(e, [{ label: "Show it", onSelect: () => setQ({ ...q, kind: k as Kind | "all" }) }, ...(k === "all" ? [] : [{ label: `Hide “${text}”`, hint: "or drag it out", onSelect: () => hideWithUndo(`type:${k}`) }])])}
              >
                {text}
              </NavRow>
            );
          })}
        </Group>
      );
    if (g === "collections")
      return (
        <Group
          key={g}
          {...common}
          label="Collections"
          listRef={colls.listRef}
          action={
            <button className="tbtn !h-[20px] !px-1" aria-label="New collection" title="New collection" onClick={() => askNewCollection()}>
              <Plus size={13} />
            </button>
          }
          after={
            cols.length === 0 && (
              <button className="w-full text-left px-2 py-1 text-[12px] leading-[1.45] rounded-[8px] transition-colors hover:bg-[var(--e1)]" style={{ color: "var(--text-3)" }} onClick={() => askNewCollection()}>
                + Make your own collection, then drag wallpapers onto it.
              </button>
            )
          }
        >
          {colKeys.map((k) => {
            const user = cols.find((c) => userKey(c) === k);
            const builtin = COLLECTIONS.find(([c]) => c === k);
            if (!user && !builtin) return null;
            const key = k as Collection;
            const show = () => setQ({ ...q, collection: key });
            return (
              <NavRow
                key={k}
                {...colls.item(k)}
                {...colls.grip(k)}
                group="collection"
                icon={user ? FolderHeart : builtin![2]}
                on={q.collection === key}
                count={collectionCount(key)}
                drop={user ? `col:${user.id}` : k === "fav" ? "fav" : undefined}
                over={user ? over?.kind === "col" && over.id === user.id : k === "fav" && over?.kind === "fav"}
                onClick={() => setQ({ ...q, collection: q.collection === key ? null : key })}
                onContextMenu={(e) =>
                  contextMenu(e, user ? userCollectionMenu(user, show, () => hideWithUndo(k)) : [{ label: "Show it", onSelect: show }, { label: `Hide “${builtin![1]}”`, hint: "or drag it out", onSelect: () => hideWithUndo(k) }])
                }
              >
                {user ? user.name : builtin![1]}
              </NavRow>
            );
          })}
        </Group>
      );
    if (g === "folders")
      return (
        <Group
          key={g}
          {...common}
          label="Folders"
          action={
            <button className="tbtn !h-[20px] !px-1" aria-label="Watch a folder" title="Watch a folder" onClick={() => startWatching()}>
              <Plus size={13} />
            </button>
          }
          after={
            watchList.length === 0 && (
              <button className="w-full text-left px-2 py-1 text-[12px] leading-[1.45] rounded-[8px] transition-colors hover:bg-[var(--e1)]" style={{ color: "var(--text-3)" }} onClick={() => startWatching()}>
                + Watch a folder: new wallpapers saved there show up here by themselves.
              </button>
            )
          }
        >
          {watchList.map((w) => {
            const key: Collection = `watch:${w.id}`;
            const st = watchStatus[w.id];
            const name = folderName(w.path);
            return (
              <NavRow
                key={w.id}
                group="folder"
                icon={w.enabled ? FolderSync : FolderX}
                on={q.collection === key}
                count={collectionCount(key)}
                title={st?.error ? `${w.path}: ${st.error}` : `${w.path}${w.enabled ? "" : " (paused)"}`}
                onClick={() => setQ({ ...q, collection: q.collection === key ? null : key })}
                onContextMenu={(e) =>
                  contextMenu(e, [
                    { label: "Show it", onSelect: () => setQ({ ...q, collection: key }) },
                    { label: "Look for new files now", onSelect: () => send("RescanWatches") },
                    { label: "Edit…", onSelect: () => useStore.getState().editWatch({ id: w.id }) },
                    { label: w.enabled ? "Pause watching" : "Resume watching", onSelect: () => setWatchEnabled(w.id, !w.enabled) },
                    { label: "Show in file manager", onSelect: () => bridge.then((b) => b.reveal(w.path)) },
                    { separator: true },
                    {
                      label: "Stop watching",
                      danger: true,
                      submenu: [
                        { label: "Keep its wallpapers", onSelect: () => stopWatching(w.id, false) },
                        { label: "Remove them from the library", hint: "files stay on disk", danger: true, onSelect: () => stopWatching(w.id, true) },
                      ],
                    },
                  ])
                }
              >
                <span style={{ color: w.enabled ? undefined : "var(--text-3)" }}>{name}</span>
                {st?.error && <span style={{ color: "var(--warn)" }}> · missing</span>}
                {!w.enabled && !st?.error && <span style={{ color: "var(--text-4)" }}> · paused</span>}
              </NavRow>
            );
          })}
        </Group>
      );
    if (g === "size") {
      const res = (screens ? ["screens"] : []).concat(["8k", "4k", "1440", "1080", "small", "any"]) as Res[];
      const shapes: Shape[] = ["wide", "landscape", "portrait"];
      return (
        <Group key={g} {...common} label="Size">
          <div className="flex flex-wrap gap-1 px-1">
            {res.map((r) => [r, sizeCount({ res: r })] as const)
              .filter(([r, n]) => n > 0 || q.res === r || r === "screens")
              .map(([r, n]) => chip(r, RES_LABEL[r], n, q.res === r, () => setQ({ ...q, res: q.res === r ? null : r }), false, { title: r === "screens" ? "At least as sharp as your biggest screen (live wallpapers always are)" : r === "any" ? "Live shaders and web pages draw at any size" : undefined }))}
          </div>
          <div className="flex flex-wrap gap-1 px-1 mt-1">
            {shapes.map((sh) => [sh, sizeCount({ shape: sh })] as const)
              .filter(([sh, n]) => n > 0 || q.shape === sh)
              .map(([sh, n]) => chip(sh, SHAPE_LABEL[sh], n, q.shape === sh, () => setQ({ ...q, shape: q.shape === sh ? null : sh })))}
          </div>
        </Group>
      );
    }
    return (
      <Group
        key={g}
        {...common}
        label="Tags"
        action={
          <button className="tbtn !h-[20px] !px-1" aria-label="New tag" title="New tag" onClick={() => newTagItem().onSelect?.()}>
            <Plus size={13} />
          </button>
        }
      >
        {tags.length === 0 ? (
          <div className="px-2 py-1 text-[12px] leading-[1.45]" style={{ color: "var(--text-3)" }}>
            No tags yet. Right-click a wallpaper, or drag some here once you've made one.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1 px-1">
            {[...visible, ...extra].map(([t, n]) => {
              const on = q.tags.includes(t);
              return chip(t, t, n, on, () => setQ({ ...q, tags: on ? q.tags.filter((x) => x !== t) : [...q.tags, t] }), over?.kind === "tag" && over.tag === t, {
                "data-drop": `tag:${t}`,
                onContextMenu: (e) => contextMenu(e, tagMenu(t, () => setQ({ ...q, tags: [t] }))),
              });
            })}
          </div>
        )}
        {tags.length > TOP_TAGS && (
          <button className="tbtn !h-[24px] !px-2 mt-1 text-[12px]" onClick={() => setAllTags(!allTags)}>
            {allTags ? "Show fewer" : `Show all ${tags.length}`}
          </button>
        )}
      </Group>
    );
  };

  return (
    <aside ref={asideRef} className="glass-pane w-[214px] shrink-0 ml-3 mb-3 rounded-[12px] overflow-y-auto overflow-x-hidden p-2 text-[13px]" onContextMenu={(e) => e.target === e.currentTarget || !(e.target as HTMLElement).closest("button") ? contextMenu(e, sidebarMenu) : undefined}>
      <div ref={groups.listRef} className="flex flex-col gap-3">
        {groupKeys.map(section)}
      </div>
      {groupKeys.length === 0 && (
        <button className="w-full text-left px-2 py-1 text-[12px] leading-[1.45] rounded-[8px] hover:bg-[var(--e1)]" style={{ color: "var(--text-3)" }} onClick={() => setPrefs(NO_PREFS)}>
          Everything is hidden. Click to bring the sidebar back.
        </button>
      )}
      <AnimatePresence>
        {filtered && (
          <motion.button
            className="btn w-full justify-center mt-3"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            onClick={() => setQ({ ...EMPTY_QUERY, sort: q.sort })}
          >
            <X size={13} /> Clear filters
          </motion.button>
        )}
      </AnimatePresence>
      {out && (
        <div className="fixed pointer-events-none glass-3 rounded-[9px] px-2.5 py-1.5 text-[12px] flex items-center gap-1.5" style={{ left: out.x + 14, top: out.y + 10, zIndex: 70 }}>
          <EyeOff size={13} /> Release to hide “{label(groups.drag === out ? `group:${out.key}` : types.drag === out ? `type:${out.key}` : out.key)}”
        </div>
      )}
    </aside>
  );
}

const KIND_NAMES: Record<string, string> = { shader: "Live shaders", photo: "Photos", video: "Videos", web: "Web pages" };
const COLLECTION_NAMES: Record<string, string> = { fav: "Favourites", screen: "On a screen", recent: "Recently added" };

function ActiveFilters({ q, setQ, count }: { q: Query; setQ(q: Query): void; count: number }) {
  const chips: [string, () => void][] = [];
  if (q.text) chips.push([`“${q.text}”`, () => setQ({ ...q, text: "" })]);
  if (q.kind !== "all") chips.push([KIND_NAMES[q.kind] ?? q.kind, () => setQ({ ...q, kind: "all" })]);
  const cols = useStore.getState().engine?.collections ?? [];
  const watched = useStore.getState().engine?.watches ?? [];
  if (q.collection) chips.push([COLLECTION_NAMES[q.collection] ?? cols.find((c) => `user:${c.id}` === q.collection)?.name ?? (q.collection.startsWith("watch:") ? `Folder ${folderName(watched.find((w) => `watch:${w.id}` === q.collection)?.path ?? "")}` : "Collection"), () => setQ({ ...q, collection: null })]);
  if (q.res) chips.push([RES_LABEL[q.res], () => setQ({ ...q, res: null })]);
  if (q.shape) chips.push([SHAPE_LABEL[q.shape], () => setQ({ ...q, shape: null })]);
  for (const t of q.tags) chips.push([`#${t}`, () => setQ({ ...q, tags: q.tags.filter((x) => x !== t) })]);
  return (
    <div className="flex items-center gap-1.5 h-[24px] mb-1 px-0.5 min-w-0 overflow-hidden">
      <span className="text-[12px] shrink-0 mr-1" style={{ color: "var(--text-3)" }}>
        {count} {count === 1 ? "result" : "results"}
      </span>
      {chips.map(([label, remove]) => (
        <button key={label} className="shrink-0 inline-flex items-center gap-1 h-[22px] pl-2 pr-1 rounded-[6px] text-[12px] transition-colors hover:bg-[var(--e3)]" style={{ background: "var(--e2)", color: "var(--text-2)" }} onClick={remove} aria-label={`Remove filter ${label}`}>
          {label}
          <X size={11} />
        </button>
      ))}
    </div>
  );
}

function CompactSidebar({ q, setQ, counts, collectionCount, tags, over, cols, typeKeys, colKeys }: { q: Query; setQ(q: Query): void; counts(k: Kind | "all"): number; collectionCount(c: Collection): number; tags: [string, number][]; over: DropTarget | null; cols: UserCollection[]; typeKeys: string[]; colKeys: string[] }) {
  const icon = (on: boolean, hot = false) => ({ background: on ? "var(--accent)" : hot ? "var(--e4)" : undefined, color: on ? "var(--accent-ink)" : "var(--text-2)" });
  return (
    <aside className="glass-pane w-[52px] shrink-0 ml-3 mb-3 rounded-[12px] overflow-y-auto py-2 flex flex-col items-center gap-1">
      {typeKeys.map((t) => TYPES.find(([k]) => k === t)!).map(([k, label, Icon]) => (
        <button key={k} data-drop={k === "shader" ? "live" : undefined} title={`${label} (${counts(k)})`} aria-label={label} className="w-[34px] h-[34px] rounded-[9px] grid place-items-center transition-colors hover:bg-[var(--e2)]" style={icon(q.kind === k, over?.kind === "live" && k === "shader")} onClick={() => setQ({ ...q, kind: k })}>
          <Icon size={15} />
        </button>
      ))}
      <span className="w-6 h-px my-1" style={{ background: "var(--edge)" }} />
      {colKeys.map((k) => {
        const user = cols.find((c) => `user:${c.id}` === k);
        const builtin = COLLECTIONS.find(([c]) => c === k);
        if (!user && !builtin) return null;
        const key = k as Collection;
        const label = user ? user.name : builtin![1];
        const Icon = user ? FolderHeart : builtin![2];
        const drop = user ? `col:${user.id}` : k === "fav" ? "fav" : undefined;
        const hot = user ? over?.kind === "col" && over.id === user.id : k === "fav" && over?.kind === "fav";
        return (
          <button key={k} data-drop={drop} title={`${label} (${collectionCount(key)})`} aria-label={label} className="w-[34px] h-[34px] rounded-[9px] grid place-items-center transition-colors hover:bg-[var(--e2)]" style={icon(q.collection === key, hot)} onClick={() => setQ({ ...q, collection: q.collection === key ? null : key })}>
            <Icon size={15} />
          </button>
        );
      })}
      <span className="w-6 h-px my-1" style={{ background: "var(--edge)" }} />
      <button
        title="Tags"
        aria-label="Tags"
        className="relative w-[34px] h-[34px] rounded-[9px] grid place-items-center transition-colors hover:bg-[var(--e2)]"
        style={icon(q.tags.length > 0)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          useStore.getState().openMenu(r.right + 6, r.top, tags.length ? tags.map(([t, n]) => ({ label: t, hint: String(n), checked: q.tags.includes(t), onSelect: () => setQ({ ...q, tags: q.tags.includes(t) ? q.tags.filter((x) => x !== t) : [...q.tags, t] }) })) : [{ label: "No tags yet", disabled: true }]);
        }}
      >
        <TagIcon size={15} />
      </button>
    </aside>
  );
}

function Group({ label, action, folded, onFold, onHide, item, grip, listRef, after, children }: {
  label: string;
  action?: React.ReactNode;
  folded?: boolean;
  onFold?(): void;
  onHide?(): void;
  item?: React.HTMLAttributes<HTMLElement>;
  grip?: React.HTMLAttributes<HTMLElement>;
  listRef?: React.Ref<HTMLDivElement>;
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section {...item}>
      <div className="flex items-center justify-between h-[26px] px-2">
        <button
          {...grip}
          className="group/h inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.07em] cursor-grab active:cursor-grabbing"
          style={{ color: "var(--text-3)" }}
          onClick={onFold}
          aria-expanded={!folded}
          title="Click to fold · drag to move"
          onContextMenu={(e) => contextMenu(e, [{ label: folded ? "Unfold" : "Fold", onSelect: () => onFold?.() }, { label: `Hide “${label}”`, hint: "or drag it out", onSelect: () => onHide?.() }])}
        >
          {label}
          <ChevronDown size={12} className="opacity-0 group-hover/h:opacity-100 transition-[opacity,transform]" style={{ transform: folded ? "rotate(-90deg)" : undefined, opacity: folded ? 1 : undefined }} />
        </button>
        {action}
      </div>
      <AnimatePresence initial={false}>
        {!folded && (
          <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }}>
            <div ref={listRef} className="flex flex-col gap-0.5">
              {children}
            </div>
            {after}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function NavRow({ group, icon: Icon, on, count, onClick, onContextMenu, drop, over, children, style, ...rest }: { group: string; icon: typeof Heart; on: boolean; count: number; onClick(): void; onContextMenu?(e: React.MouseEvent): void; drop?: string; over?: boolean; children: React.ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onContextMenu" | "children">) {
  return (
    <button {...rest} data-drop={drop} className="relative w-full flex items-center gap-2.5 h-[32px] px-1.5 rounded-[8px] text-left transition-colors hover:bg-[var(--e1)]" style={{ color: on || over ? "var(--text)" : "var(--text-2)", ...style }} onClick={onClick} onContextMenu={onContextMenu}>
      {on && <motion.span layoutId={`nav-${group}`} className="absolute inset-0 rounded-[8px]" style={{ background: "var(--e3)" }} transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
      {over && <span className="absolute inset-0 rounded-[8px]" style={{ background: "var(--e4)", boxShadow: "inset 0 0 0 1px var(--accent)" }} />}
      <span className="relative w-[22px] h-[22px] rounded-[6px] grid place-items-center shrink-0 transition-colors" style={{ background: on ? "var(--accent)" : "var(--e2)", color: on ? "var(--accent-ink)" : "var(--text-2)" }}>
        <Icon size={13} />
      </span>
      <span className="relative flex-1 truncate">{children}</span>
      <span className="relative mono text-[11px] min-w-[22px] text-right" style={{ color: on ? "var(--text-2)" : "var(--text-4)" }}>{count}</span>
    </button>
  );
}

function Bulk({ ws, viewingTag }: { ws: Wallpaper[]; viewingTag?: string }) {
  const { select, setFavourite } = useStore.getState();
  const own = ws.filter((w) => w.own);
  const allFav = ws.every((w) => w.fav);
  const allLive = own.length > 0 && own.every((w) => w.alsoLive);
  const common = ws.reduce<string[]>((acc, w, i) => (i === 0 ? [...w.tags] : acc.filter((t) => w.tags.includes(t))), []);
  return (
    <div className="flex-1 min-h-0 flex flex-col p-4 gap-4">
      <div className="grid grid-cols-3 gap-1.5">
        {ws.slice(0, 6).map((w) => (
          <MiniThumb key={w.id} w={w} />
        ))}
      </div>
      <div>
        <div className="text-[20px] font-semibold tracking-[-0.005em]">{ws.length} selected</div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
          {[...new Set(ws.map((w) => KIND_LABEL[w.kind]))].join(", ")}
        </div>
      </div>
      <div>
        <div className="text-[13px] mb-1.5" style={{ color: "var(--text-2)" }}>Tags on all of them</div>
        <div className="flex flex-wrap gap-1.5">
          {common.length ? common.map((t) => (
            <span key={t} className="h-[22px] px-2 rounded-[6px] text-[11px] inline-flex items-center" style={{ background: "var(--e2)" }}>{t}</span>
          )) : <span className="text-[11px]" style={{ color: "var(--text-3)" }}>None in common</span>}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button className="btn justify-start" onClick={(e) => contextMenu(e, wallpaperMenu(ws, { viewingTag }).filter((i) => i.label === "Tags" || i.label === "Add to collection" || (i.label ?? "").startsWith("Move from"))) }>
          Tags…
        </button>
        <button className="btn justify-start" onClick={() => ws.forEach((w) => setFavourite(w, !allFav))}>
          <Heart size={13} fill={allFav ? "currentColor" : "none"} /> {allFav ? "Remove from favourites" : "Add to favourites"}
        </button>
        {own.length > 0 && (
          <button className="btn justify-start" onClick={() => own.forEach((w) => send({ SetAlsoLive: { path: w.path, on: !allLive } }))}>
            <Sparkles size={13} /> {allLive ? "Stop listing under Live shaders" : `List ${own.length === ws.length ? "them" : `your ${own.length}`} under Live shaders`}
          </button>
        )}
      </div>
        <button
          className="btn justify-start"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const ms = useStore.getState().engine?.monitors ?? [];
            useStore.getState().openMenu(r.left, r.bottom + 4, ms.map((m) => ({ label: `On ${m.name}`, hint: "every hour", onSelect: () => rotateThrough(m.name, ws.map((w) => w.path), `${ws.length} picked`) })));
          }}
        >
          <Repeat size={13} /> Rotate these on…
        </button>
        {own.length > 0 && (
          <button className="btn justify-start" style={{ color: "var(--err)" }} onClick={() => removeWallpapers(own)}>
            <Trash2 size={13} /> Remove {own.length === ws.length ? "from library" : `your ${own.length}`}
          </button>
        )}
      <div className="flex-1" />
      <button className="tbtn self-start" onClick={() => select([], null)}>Deselect all</button>
    </div>
  );
}

function MiniThumb({ w }: { w: Wallpaper }) {
  const thumb = useThumb(w);
  return (
    <div className="relative aspect-video rounded-[6px] overflow-hidden" style={{ background: "#0b0b0f" }}>
      <Preview look={w.look} src={thumb} />
    </div>
  );
}

function Tile({ w, selected, onClick, onApply, onMenu, onDragStart }: { w: Wallpaper; selected: boolean; onClick(e: React.MouseEvent): void; onApply(): void; onMenu(e: React.MouseEvent): void; onDragStart(e: React.PointerEvent): void }) {
  const thumb = useThumb(w);
  const monitors = useStore((s) => s.engine?.monitors);
  const playing = (monitors ?? []).filter((m) => m.wallpaper === w.path).map((m) => m.name);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 34 }}
      className="group cursor-pointer select-none"
      onClick={onClick}
      onDoubleClick={onApply}
      onContextMenu={onMenu}
      onPointerDown={onDragStart}
    >
      <div
        className="relative aspect-video rounded-[10px] overflow-hidden transition-shadow"
        style={{ background: "#0b0b0f", boxShadow: selected ? "0 0 0 2px var(--accent)" : "inset 0 0 0 1px rgba(255,255,255,.07)" }}
      >
        <LookLayer path={w.path}>
          <Preview look={w.look} src={thumb} />
        </LookLayer>
        {selected && <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(236,232,225,.08)" }} />}
        {playing.length > 0 && (
          <span className="absolute left-1.5 top-1.5 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium" style={{ background: "rgba(0,0,0,.6)", color: "var(--text)" }}>
            On {playing.join(" + ")}
          </span>
        )}
        {w.fav && <Heart size={12} fill="currentColor" className="absolute right-2 top-2" style={{ color: "var(--err)" }} />}
      </div>
      <div className="px-0.5 pt-1.5">
        <div className="text-[13px] font-medium truncate" style={{ color: selected ? "var(--text)" : "var(--text-2)" }}>{w.name}</div>
        <div className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>
          {KIND_LABEL[w.kind]}
          {resOf(w) !== "any" && ` · ${RES_LABEL[resOf(w)]}`}
          {w.alsoLive && " · in Live shaders"}
          {w.tags.length > 0 && ` · ${w.tags.slice(0, 3).join(", ")}`}
        </div>
      </div>
    </motion.div>
  );
}
