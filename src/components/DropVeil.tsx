

import { AnimatePresence, motion } from "motion/react";
import { Film, FileArchive, FolderInput, Globe, ImagePlus } from "lucide-react";
import { useStore } from "../lib/store";

const PATHS = [
  { icon: ImagePlus, from: "Photo", to: "Living wallpaper", note: "moves with your cursor", ready: true },
  { icon: Film, from: "Video", to: "Looping wallpaper", note: "mp4 · mkv · webm, with sound", ready: true },
  { icon: Globe, from: "HTML", to: "Web wallpaper", note: "a page or a folder with index.html", ready: true },
  { icon: FolderInput, from: "Folder", to: "Import many", note: "pick what to bring in, name and tag it", ready: true },
  { icon: FileArchive, from: ".zwall", to: "Import", note: "someone's shared wallpaper", ready: true },
];

export function DropVeil() {
  const over = useStore((s) => s.fileOver);
  return (
    <AnimatePresence>
      {over && (
        <motion.div
          className="fixed inset-0 grid place-items-center"
          style={{ zIndex: 40, background: "rgba(5,5,8,.86)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          <motion.div
            className="relative flex flex-col items-center gap-6 rounded-[24px] px-14 py-12"
            initial={{ scale: 0.94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 180, damping: 24, delay: 0.04 }}
          >
            <div className="target-ring !inset-0 !rounded-[24px]" />
            <div className="text-center">
              <div className="text-[28px] font-semibold tracking-[-0.015em] leading-[1.15]">Let go to make it live</div>
              <div className="text-[15px] mt-1.5" style={{ color: "var(--text-2)" }}>
                It lands on your shelf, then you drag it onto a screen.
              </div>
            </div>
            <div className="flex gap-3">
              {PATHS.map(({ icon: Icon, from, to, note, ready }, i) => (
                <motion.div
                  key={from}
                  className="glass rounded-[12px] px-4 py-3 w-[180px]"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: ready ? 1 : 0.45, y: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.1 + i * 0.05 }}
                >
                  <Icon size={18} strokeWidth={1.5} style={{ color: "var(--text-2)" }} />
                  <div className="text-[13px] font-medium mt-2">
                    {from} <span style={{ color: "var(--text-3)" }}>→</span> {to}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-3)" }}>{note}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
