

import { AnimatePresence, motion } from "motion/react";
import { importFolder } from "../lib/actions";
import { importFiles } from "../lib/intake";
import { contextMenu } from "./ui/Menu";
import { ImagePlus, Search, X } from "lucide-react";
import { inKind, matches } from "../lib/search";
import { useState } from "react";
import { useStore } from "../lib/store";
import type { Kind } from "../lib/types";

type Filter = Kind | "all" | "fav";
import { Card } from "./Card";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "shader", label: "Live shaders" },
  { id: "photo", label: "Photos" },
  { id: "video", label: "Videos" },
  { id: "web", label: "Web pages" },
  { id: "fav", label: "Favourites" },
];

export function Shelf() {
  const library = useStore((s) => s.library);
  const inspecting = useStore((s) => s.inspecting);
  const [filter, setFilter] = useState<Filter>("all");
  const [text, setText] = useState("");

  const shown = library.filter((w) => (filter === "fav" ? w.fav : inKind(w, filter as Kind | "all")) && matches(w, text));

  return (
    <motion.section
      className="relative shrink-0 px-5 pt-3 pb-4"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 180, damping: 24, delay: 0.2 }}
    >
      <div className="@container flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-1 shrink-0">
          {FILTERS.map((f) => (
            <button key={f.id} className="chip focusable" data-on={filter === f.id} onClick={() => setFilter(f.id)}>
              {filter === f.id && <motion.span layoutId="chip" className="absolute inset-0 rounded-[7px]" style={{ background: "var(--e3)", boxShadow: "inset 0 1px 0 var(--edge-top)" }} transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
              <span className="relative">{f.label}</span>
            </button>
          ))}
        </div>
        <Hints />
        <div className="relative shrink-0 w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          <input
            className="w-full h-[28px] pl-8 pr-7 rounded-[7px] text-[12px] outline-none"
            style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
            placeholder="Search"
            aria-label="Search the shelf"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setText(""), (e.target as HTMLInputElement).blur())}
          />
          {text && (
            <button className="tbtn absolute right-0.5 top-1/2 -translate-y-1/2 !h-[22px] !px-1.5" aria-label="Clear search" onClick={() => setText("")}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="scroll-x fade-x -mx-5 px-5 py-3 flex gap-3.5" onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}>
        <CreateSlot />
        <AnimatePresence mode="popLayout">
          {shown.map((w, i) => (
            <Card key={w.id} w={w} index={i} active={inspecting === w.id} />
          ))}
        </AnimatePresence>
        {shown.length === 0 && (
          <div className="self-center text-[13px] pl-2" style={{ color: "var(--text-3)" }}>
            {text
              ? `Nothing matches “${text}”.`
              : filter === "fav"
                ? "Heart a wallpaper in its settings and it lives here."
                : `No ${filter === "video" ? "videos" : filter === "web" ? "web pages" : "photos"} yet. Click “Add your own” or drop files on this window.`}
          </div>
        )}
      </div>
    </motion.section>
  );
}

function CreateSlot() {
  return (
    <motion.button
      className="shrink-0 rounded-[12px] flex flex-col justify-between p-3 text-left transition-colors hover:bg-[var(--e2)] focusable"
      style={{ width: 208, height: 124, background: "var(--e1)", border: "1px dashed rgba(255,255,255,.18)" }}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.3 }}
      whileTap={{ scale: 0.98 }}
      onClick={importFiles}
      onContextMenu={(e) => contextMenu(e, [
        { label: "Add files…", onSelect: importFiles },
        { label: "Import a folder…", onSelect: importFolder },
      ])}
    >
      <div style={{ color: "var(--text-2)" }}>
        <ImagePlus size={18} strokeWidth={1.5} />
      </div>
      <div>
        <div className="text-[13px] font-medium leading-[1.3]">Add your own</div>
        <div className="text-[12px] leading-[1.35]" style={{ color: "var(--text-3)" }}>
          Click to pick photos, videos or web pages, or drop them anywhere
        </div>
      </div>
    </motion.button>
  );
}

function Hints() {
  return (

    <div className="hidden @[1260px]:block min-w-0 truncate text-[12px]" style={{ color: "var(--text-3)" }}>
      Drag a card onto a screen, or between two to span them. Click a card for its settings.
    </div>
  );
}
