

import { AnimatePresence, motion } from "motion/react";
import { Film, FolderOpen, Globe, ImageIcon, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createCollection } from "../lib/collections";
import { bridge, type Found } from "../lib/ipc";
import { useStore } from "../lib/store";
import type { Watch } from "../lib/types";
import * as watches from "../lib/watches";
import { Dropdown } from "./ui/Dropdown";
import { Switch } from "./ui/Switch";

const KINDS: [string, string, typeof ImageIcon][] = [
  ["photo", "Photos", ImageIcon],
  ["video", "Videos", Film],
  ["web", "Web pages", Globe],
];

export function WatchDialog() {
  const edit = useStore((s) => s.watchEdit);
  return <AnimatePresence>{edit && <Editor key={edit.id ?? edit.path} edit={edit} />}</AnimatePresence>;
}

function Editor({ edit }: { edit: { id?: string; path?: string } }) {
  const close = () => useStore.getState().editWatch(null);
  const existing = useStore((s) => s.engine?.watches.find((w) => w.id === edit.id));
  const cols = useStore((s) => s.engine?.collections) ?? [];
  const library = useStore((s) => s.library);
  const [w, setW] = useState<Watch>(() => existing ?? watches.blankWatch(edit.path ?? ""));
  const [found, setFound] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagText, setTagText] = useState(w.tags.join(", "));

  const [target, setTarget] = useState<string>(w.collection ?? "");
  const name = watches.folderName(w.path);


  useEffect(() => {
    setFound(null);
    setError(null);
    bridge.then((b) => b.scanFolder(w.path, w.recursive)).then(
      (f) => setFound(f.filter((x) => !x.skip && (x.kind === "photo" || x.kind === "video" || x.kind === "web"))),
      (e) => setError(String(e)),
    );
  }, [w.path, w.recursive]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const count = (k: string) => found?.filter((f) => f.kind === k).length ?? 0;
  const takes = (k: string) => !w.kinds.length || w.kinds.includes(k);
  const toggleKind = (k: string) => {
    const cur = w.kinds.length ? w.kinds : KINDS.map(([x]) => x);
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    setW({ ...w, kinds: next.length === KINDS.length ? [] : next.length ? next : [k] });
  };
  const taken = found?.filter((f) => takes(f.kind)) ?? [];
  const already = useMemo(() => new Set(library.map((x) => x.path)), [library]);
  const fresh = taken.filter((f) => !already.has(f.path) && !w.ignored.includes(f.path)).length;
  const fromHere = library.filter((x) => x.fromWatch === w.id).length;

  const changeFolder = async () => {
    const dir = await (await bridge).pickFolder("Watch a folder for new wallpapers");
    if (dir) setW({ ...w, path: dir });
  };
  const done = () => {
    let collection = target || null;
    if (target === "__new") collection = createCollection(name);
    watches.upsert({ ...w, collection, tags: tagText.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) });
    if (!existing) useStore.getState().toast("ok", fresh ? `Watching ${name}: ${fresh} wallpaper${fresh === 1 ? "" : "s"} coming in` : `Watching ${name}. New wallpapers there will show up by themselves.`);
    close();
  };
  const stopMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    useStore.getState().openMenu(r.left, r.top - 8 - 3 * 30, [
      { heading: true, label: `Stop watching ${name}` },
      { label: "Keep its wallpapers", hint: `${fromHere} stay`, onSelect: () => (watches.stopWatching(w.id, false), close()) },
      { label: "Remove them from the library", hint: "files stay on disk", danger: true, onSelect: () => (watches.stopWatching(w.id, true), close()) },
    ]);
  };

  return (
    <motion.div className="fixed inset-0 grid place-items-center p-6" style={{ zIndex: 80, background: "rgba(5,5,8,.22)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <motion.div role="dialog" aria-label={`Watch ${name}`} className="glass-3 w-[min(560px,100%)] max-h-full overflow-y-auto rounded-[16px] p-5 flex flex-col gap-5" initial={{ y: 8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 4, opacity: 0 }}>

        <div className="flex items-start gap-3">
          <span className="w-[38px] h-[38px] rounded-[10px] grid place-items-center shrink-0" style={{ background: "var(--e2)", color: "var(--text-2)" }}>
            <FolderOpen size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold truncate">{existing ? name : `Watch ${name}`}</div>
            <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-3)" }} title={w.path}>{w.path}</div>
          </div>
          <button className="tbtn !h-[26px] shrink-0" onClick={changeFolder}>Change…</button>
          <button className="tbtn !h-[26px] !px-1.5 shrink-0" aria-label="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>


        <section>
          <div className="text-[13px] mb-2" style={{ color: "var(--text-2)" }}>
            {error ? <span style={{ color: "var(--err)" }}>Can't read this folder: {error}</span> : found === null ? "Looking through it…" : found.length ? `Found ${found.length} wallpaper${found.length === 1 ? "" : "s"}. Take:` : "Nothing in it yet; new files will be picked up as they arrive. Take:"}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map(([k, label, Icon]) => {
              const on = takes(k);
              return (
                <button
                  key={k}
                  role="checkbox"
                  aria-checked={on}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-[11px] text-left transition-colors"
                  style={{ background: on ? "var(--e3)" : "var(--e1)", boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--edge)", color: on ? "var(--text)" : "var(--text-3)" }}
                  onClick={() => toggleKind(k)}
                >
                  <Icon size={16} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{label}</span>
                    <span className="block mono text-[11px]" style={{ color: "var(--text-3)" }}>{found === null ? "…" : count(k)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="text-[11px] mt-2" style={{ color: "var(--text-3)" }}>
            Photos: jpg, png, webp, avif · Videos: mp4, mkv, webm, mov, gif · Web: .html files and folders with an index.html · Wallpaper Engine projects count too.
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Line label="Look in subfolders" hint="Everything below this folder, not just what's directly in it.">
            <Switch label="Look in subfolders" on={w.recursive} onChange={(recursive) => setW({ ...w, recursive })} />
          </Line>
          <Line label="Put new ones in" hint="New finds also join this collection.">
            <Dropdown<string>
              label="Collection"
              value={target}
              width={200}
              options={[["", "No collection"], ...cols.map((c): [string, string] => [c.id, c.name]), ...(cols.some((c) => c.name === name) ? [] : [["__new", `New collection “${name}”`] as [string, string]])]}
              onChange={setTarget}
            />
          </Line>
          <Line label="Tag them" hint="Comma-separated, added to everything new from here.">
            <input
              className="w-[200px] h-[30px] px-2.5 rounded-[8px] text-[13px] outline-none"
              style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
              placeholder="e.g. anime, downloads"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
            />
          </Line>
          <Line label="When a file is deleted" hint={w.prune ? "It leaves your library too." : "It stays in your library (and stops playing if it was on a screen)."}>
            <Switch label="Remove deleted files from the library" on={w.prune} onChange={(prune) => setW({ ...w, prune })} />
          </Line>
          {existing && (
            <Line label="Watching" hint={w.enabled ? "Checked every half minute." : "Paused: nothing new comes in until you turn it back on."}>
              <Switch label="Watching" on={w.enabled} onChange={(enabled) => setW({ ...w, enabled })} />
            </Line>
          )}
        </section>

        <div className="flex items-center gap-2">
          {existing && (
            <button className="tbtn" style={{ color: "var(--err)" }} onClick={stopMenu}>
              Stop watching…
            </button>
          )}
          <div className="flex-1 text-[12px]" style={{ color: "var(--text-3)" }}>
            {!existing && found !== null && !error && (fresh ? `${fresh} will be added now` : taken.length ? "All of them are in your library already" : "")}
          </div>
          <button className="tbtn" onClick={close}>Cancel</button>
          <button className="btn btn-primary" disabled={!w.path || !!error} onClick={done}>
            {existing ? "Save" : "Watch this folder"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Line({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px]" style={{ color: "var(--text)" }}>{label}</div>
        <div className="text-[11px] leading-[1.4]" style={{ color: "var(--text-3)" }}>{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
