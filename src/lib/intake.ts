

import { send } from "./actions";
import { bridge } from "./ipc";
import { useStore } from "./store";
import type { Wallpaper } from "./types";

const DEVELOP_MS = 900;
const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

export async function importPaths(paths: string[]) {
  const b = await bridge;
  const { addWallpaper, finishDeveloping, toast } = useStore.getState();
  let added = 0;
  for (const path of paths) {
    const kind = await b.classify(path);
    if (kind === "zwall") {
      send({ Import: { file: path } });
      continue;
    }
    if (kind === "folder") {
      useStore.getState().openImport(path);
      continue;
    }
    if (kind !== "parallax" && kind !== "video" && kind !== "web") {
      const why = {
        shader: "custom shaders arrive with the shader editor",
        unsupported: "that isn't a photo ZWall can read",
      }[kind];
      toast("error", `${baseName(path)}: ${why}`);
      continue;
    }
    const w: Wallpaper = {
      id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path,

      name: kind === "web" && /index\.html?$/i.test(path) ? baseName(path.replace(/[\\/][^\\/]+$/, "")) : baseName(path),
      kind: kind === "video" ? "video" : kind === "web" ? "web" : "photo",
      look: kind === "video" ? "video" : kind === "web" ? "web" : "photo",
      glow: ["#c94bff", "#4b7bff"],
      developing: true,
      own: true,
      tags: [],
    };
    addWallpaper(w);
    added++;
    setTimeout(() => finishDeveloping(w.id), DEVELOP_MS);
  }
  if (added) toast("ok", added === 1 ? "On your shelf · drag it onto a screen" : `${added} new wallpapers on your shelf`);
}


export async function importFiles() {
  const paths = await (await bridge).pickFiles();
  if (paths.length) await importPaths(paths);
}
