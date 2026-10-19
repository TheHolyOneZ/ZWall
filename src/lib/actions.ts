import { bridge } from "./ipc";
import { useStore } from "./store";
import type { Request, Wallpaper } from "./types";
import { rememberBeforePlacing } from "./undo";

export async function send(req: Request) {
  try {
    await (await bridge).send(req);
  } catch (e) {
    useStore.getState().toast("error", String(e));
  }
}

export function place(w: Wallpaper, target: string) {
  if (w.developing) return useStore.getState().toast("error", `${w.name} is still developing`);
  const back = rememberBeforePlacing(target);
  if (back) useStore.getState().toast("ok", `${w.name} → ${target === "all" ? "all screens" : target.replace("span:", "").replace("+", " + ")}`, { label: "Undo", run: back });
  if (target === "all") return send({ SetWallpaper: { path: w.path, monitors: [] } });
  if (target.startsWith("span:")) return send({ Span: { path: w.path, monitors: target.slice(5).split("+") } });
  return send({ SetWallpaper: { path: w.path, monitors: [target] } });
}

export function describeTarget(target: string | null) {
  if (!target) return "Drop on a screen";
  if (target.startsWith("span:")) return `Span across ${target.slice(5).split("+").join(" + ")}`;
  return `Play on ${target}`;
}

export async function importFolder() {
  const dir = await (await bridge).pickFolder();
  if (dir) useStore.getState().openImport(dir);
}

export async function importWallpaperEngine() {
  const dir = await (await bridge).wallpaperEngineFolder();
  if (dir) return useStore.getState().openImport(dir);
  useStore.getState().toast("error", "Couldn't find Wallpaper Engine's Workshop folder. Use Import › Folder… and pick it yourself.");
}
