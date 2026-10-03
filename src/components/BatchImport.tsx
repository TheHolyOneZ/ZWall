

import { AnimatePresence, motion } from "motion/react";
import { Ban, FileArchive, Film, FolderOpen, Globe, ImageIcon, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { send } from "../lib/actions";
import { bridge, type Found } from "../lib/ipc";
import { useStore } from "../lib/store";
import { Toggle } from "./SettingsPanel";
import { Check } from "./ui/Check";

type Kind = Found["kind"];
const KINDS: [Kind, string, typeof Globe][] = [
  ["web", "Web pages", Globe],
  ["video", "Videos", Film],
  ["photo", "Photos", ImageIcon],
  ["zwall", ".zwall", FileArchive],
  ["scene", "Can't import", Ban],
];

const SHOWN = 300;

interface Row {
  on: boolean;
  name: string;
  tags: string;
}

const splitTags = (t: string) => t.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const size = (b: number) => (b <= 0 ? "" : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export function BatchImport() {
  const dir = useStore((s) => s.importing);
  const openImport = useStore((s) => s.openImport);
  return <AnimatePresence>{dir && <Dialog key={dir} dir={dir} close={() => openImport(null)} />}</AnimatePresence>;
}

function Dialog({ dir, close }: { dir: string; close(): void }) {
  const library = useStore((s) => s.library);
  const [recursive, setRecursive] = useState(true);
  const [found, setFound] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(["web", "video", "photo", "zwall", "scene"]));
  const [text, setText] = useState("");
  const [allTags, setAllTags] = useState("");
  const [folderTag, setFolderTag] = useState(false);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => new Set(library.map((w) => w.path)), [library]);

  useEffect(() => {
    let live = true;
    setFound(null);
    setError(null);
    bridge.then((b) => b.scanFolder(dir, recursive)).then(
      (f) => {
        if (!live) return;
        setFound(f);
        setRows((prev) => Object.fromEntries(f.map((x) => [x.path, prev[x.path] ?? { on: !known.has(x.path) && !x.skip, name: x.name, tags: (x.tags ?? []).join(", ") }])));
      },
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [dir, recursive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, close]);

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (found ?? []).filter((f) => kinds.has(f.kind) && words.every((w) => `${rows[f.path]?.name ?? f.name} ${f.folder}`.toLowerCase().includes(w)));

  const importable = (f: Found) => !known.has(f.path) && !f.skip;
  const chosen = shown.filter((f) => rows[f.path]?.on && !known.has(f.path) && !f.skip);
  const shownChosen = chosen.length;
  const hidden = (found ?? []).filter(importable).length - shown.filter(importable).length;
  const count = (k: Kind) => (found ?? []).filter((f) => f.kind === k).length;
  const patch = (path: string, p: Partial<Row>) => setRows((r) => ({ ...r, [path]: { ...r[path], ...p } }));
  const setShown = (on: boolean) => setRows((r) => ({ ...r, ...Object.fromEntries(shown.filter(importable).map((f) => [f.path, { ...r[f.path], on }])) }));

  const changeFolder = async () => {
    const d = await (await bridge).pickFolder();
    if (d) useStore.getState().openImport(d);
  };

  const run = async () => {
    setBusy(true);
    const shared = splitTags(allTags);
    for (const f of chosen) {
      const row = rows[f.path];
      if (f.kind === "zwall") {
        await send({ Import: { file: f.path } });
        continue;
      }
      await send({ AddToLibrary: { path: f.path, name: row.name.trim() || f.name, kind: f.kind as "photo" | "video" | "web" } });
      const folder = folderTag && f.folder ? [f.folder.split(/[\\/]/).pop()!.toLowerCase()] : [];
      const tags = [...new Set([...shared, ...folder, ...splitTags(row.tags)])];
      if (tags.length) await send({ SetTags: { path: f.path, tags } });
    }
    if (shared.length || folderTag) {
      const list = useStore.getState().engine?.tag_list ?? [];
      const extra = [...shared, ...(folderTag ? chosen.map((f) => f.folder.split(/[\\/]/).pop()!.toLowerCase()).filter(Boolean) : [])];
      const next = [...new Set([...list, ...extra])];
      if (next.length !== list.length) await send({ SetTagList: next });
    }
    useStore.getState().toast("ok", `Imported ${chosen.length} wallpaper${chosen.length === 1 ? "" : "s"}`);
    setBusy(false);
    close();
  };

  return (
    <motion.div className="fixed inset-0 grid place-items-center" style={{ zIndex: 85, background: "rgba(5,5,8,.22)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <motion.div className="glass-3 w-[min(980px,calc(100vw-48px))] h-[min(680px,calc(100vh-48px))] rounded-[16px] flex flex-col overflow-hidden" initial={{ y: 10, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, opacity: 0 }}>

        <div className="flex items-center gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Import from a folder</div>
            <div className="mono text-[11px] truncate mt-0.5" style={{ color: "var(--text-3)" }} title={dir}>{dir}</div>
          </div>
          <button className="btn" onClick={changeFolder}><FolderOpen size={13} /> Change folder</button>
          <button className="tbtn !px-1.5" aria-label="Close" onClick={close} disabled={busy}><X size={15} /></button>
        </div>


        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          {KINDS.map(([k, label, Icon]) => (
            <button
              key={k}
              className="inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[7px] text-[12px] transition-colors"
              style={{ background: kinds.has(k) ? "var(--e3)" : "var(--e1)", color: kinds.has(k) ? "var(--text)" : "var(--text-3)", border: "1px solid var(--edge)" }}
              onClick={() => setKinds((s) => {
                const n = new Set(s);
                if (n.has(k)) n.delete(k); else n.add(k);
                return n;
              })}
              aria-pressed={kinds.has(k)}
            >
              <Icon size={13} /> {label} <span className="mono text-[11px]" style={{ color: "var(--text-4)" }}>{count(k)}</span>
            </button>
          ))}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
            <input
              className="w-full h-[28px] pl-8 pr-2 rounded-[7px] text-[12px] outline-none"
              style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
              placeholder="Name or folder contains… (e.g. 4k, 2024, rain)"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="w-[190px]">
            <Toggle label="Include subfolders" on={recursive} onChange={setRecursive} />
          </div>
        </div>


        <div className="flex-1 min-h-0 overflow-y-auto border-y" style={{ borderColor: "var(--edge)" }}>
          {error ? (
            <Empty>{error}</Empty>
          ) : !found ? (
            <Empty>Looking through the folder…</Empty>
          ) : found.length === 0 ? (
            <Empty>Nothing to import here. ZWall imports web pages (.html, or a folder with index.html), videos (mp4, mkv, webm, mov, gif), photos and .zwall files.</Empty>
          ) : shown.length === 0 ? (
            <Empty>Nothing matches the filter.</Empty>
          ) : (
            <table className="w-full text-[12px] border-separate border-spacing-0">
              <thead className="sticky top-0" style={{ background: "var(--e1)", zIndex: 1 }}>
                <tr style={{ color: "var(--text-3)" }} className="text-left">
                  <th className="w-[40px] pl-5 py-2 font-normal">
                    <Check
                      label="Select all shown"
                      on={shownChosen > 0 && shownChosen === shown.filter(importable).length}
                      mixed={shownChosen > 0 && shownChosen < shown.filter(importable).length}
                      onChange={(v) => setShown(v && shownChosen === 0)}
                    />
                  </th>
                  <th className="font-normal py-2">Name</th>
                  <th className="font-normal py-2 w-[90px]">Type</th>
                  <th className="font-normal py-2 w-[160px]">Folder</th>
                  <th className="font-normal py-2 w-[200px] pr-5">Tags</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, SHOWN).map((f) => {
                  const r = rows[f.path];
                  const dup = known.has(f.path) || !!f.skip;
                  if (!r) return null;
                  return (
                    <tr key={f.path} style={{ opacity: dup ? 0.45 : r.on ? 1 : 0.6 }}>
                      <td className="pl-5 py-1">
                        <Check label={`Import ${r.name}`} disabled={dup} on={r.on && !dup} onChange={(on) => patch(f.path, { on })} />
                      </td>
                      <td className="py-1 pr-3">
                        <input
                          className="w-full h-[26px] px-2 rounded-[6px] outline-none bg-transparent hover:bg-[var(--e1)] focus:bg-[var(--e1)]"
                          style={{ color: "var(--text)" }}
                          value={r.name}
                          disabled={dup}
                          onChange={(e) => patch(f.path, { name: e.target.value })}
                          title={f.path}
                        />
                        {f.source === "wallpaper-engine" && (
                          <span className="ml-2 inline-flex h-[18px] px-1.5 items-center rounded-[5px] text-[11px] font-medium align-middle" style={{ background: "var(--e2)", color: "var(--text-2)" }}>
                            Wallpaper Engine
                          </span>
                        )}
                        {dup && <span className="text-[12px] pl-2" style={{ color: "var(--text-3)" }}>{f.skip ?? "already in your library"}</span>}
                      </td>
                      <td className="py-1" style={{ color: "var(--text-2)" }}>
                        {f.kind === "scene" ? "Scene" : KINDS.find(([k]) => k === f.kind)?.[1].replace(/s$/, "")}
                        <span className="mono text-[11px] pl-1.5" style={{ color: "var(--text-4)" }}>{size(f.bytes)}</span>
                      </td>
                      <td className="py-1 pr-3 truncate max-w-[160px]" style={{ color: "var(--text-3)" }} title={f.folder}>{f.folder || "—"}</td>
                      <td className="py-1 pr-5">
                        <input
                          className="w-full h-[26px] px-2 rounded-[6px] outline-none"
                          style={{ background: "var(--e1)", color: "var(--text)" }}
                          placeholder="tags, comma separated"
                          value={r.tags}
                          disabled={dup || f.kind === "zwall"}
                          onChange={(e) => patch(f.path, { tags: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {shown.length > SHOWN && (
            <div className="px-5 py-3 text-[12px]" style={{ color: "var(--text-3)" }}>
              Showing {SHOWN} of {shown.length}. Narrow the filter to see the rest; “select all” still covers every match.
            </div>
          )}
        </div>


        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            <span className="text-[12px] shrink-0" style={{ color: "var(--text-2)" }}>Tags for all</span>
            <input
              className="flex-1 h-[28px] px-2 rounded-[7px] text-[12px] outline-none"
              style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
              placeholder="e.g. anime, cosy"
              value={allTags}
              onChange={(e) => setAllTags(e.target.value)}
            />
          </div>
          <div className="w-[230px]">
            <Toggle label="Tag each with its folder" on={folderTag} onChange={setFolderTag} />
          </div>
          <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
            {chosen.length} of {shown.filter(importable).length} shown{hidden > 0 ? ` · ${hidden} filtered out` : ""}
          </span>
          <button className="btn btn-primary" disabled={!chosen.length || busy} onClick={run}>
            {busy ? "Importing…" : `Import ${chosen.length || ""}`.trim()}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full grid place-items-center px-10 text-center text-[13px]" style={{ color: "var(--text-3)" }}>
      <div className="max-w-[460px] leading-[1.5]">{children}</div>
    </div>
  );
}
