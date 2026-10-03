

import { send } from "./actions";
import { PRESETS } from "./presets";
import { useStore } from "./store";
import type { Action, Automation, Kind, Source, Trigger } from "./types";

export const all = (): Automation[] => useStore.getState().engine?.automations ?? [];
export const save = (list: Automation[]) => send({ SetAutomations: list });
export const newId = () => Math.random().toString(36).slice(2, 10);

export function update(id: string, patch: Partial<Automation>) {
  save(all().map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

export function add(...items: Omit<Automation, "id">[]): string[] {
  const made = items.map((a) => ({ ...a, id: newId() }));
  save([...all(), ...made]);
  return made.map((a) => a.id);
}

export function remove(id: string) {
  const before = all();
  const gone = before.find((a) => a.id === id);
  if (!gone) return;
  save(before.filter((a) => a.id !== id));
  useStore.getState().toast("ok", `Deleted “${title(gone)}”`, { label: "Undo", run: () => save(before) });
}

export function duplicate(id: string) {
  const list = all();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return;
  const copy = { ...list[i], id: newId(), name: list[i].name ? `${list[i].name} (copy)` : "" };
  save([...list.slice(0, i + 1), copy, ...list.slice(i + 1)]);
  return copy.id;
}


export function tagSource(tag: string): Source {
  return { type: "tag", tag, builtin: PRESETS.filter((p) => p.tags.includes(tag)).map((p) => p.path) };
}


export const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function daysText(days: number[]): string {
  const d = [...days].sort();
  if (!d.length || d.length === 7) return "every day";
  if (d.join() === "0,1,2,3,4") return "on weekdays";
  if (d.join() === "5,6") return "on weekends";
  return `on ${d.map((i) => DAY_NAMES[i].slice(0, 3)).join(", ")}`;
}

export function everyText(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "every day" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`;
  return `every ${minutes} min`;
}

export function triggerText(t: Trigger): string {
  switch (t.type) {
    case "at":
      return `at ${t.time}`;
    case "every":
      return everyText(t.minutes);
    case "app_opens":
      return `when ${t.app || "an app"} opens`;
    case "on_battery":
      return "when the charger is unplugged";
    case "plugged_in":
      return "when the charger is plugged in";
    case "startup":
      return "when ZWall starts";
  }
}

const KIND_WORDS: Record<Kind, string> = { shader: "live shaders", photo: "photos", video: "videos", web: "web pages" };

export function sourceText(s: Source): string {
  switch (s.type) {
    case "everything":
      return "everything";
    case "favourites":
      return "favourites";
    case "collection":
      return useStore.getState().engine?.collections.find((c) => c.id === s.id)?.name ?? "a deleted collection";
    case "tag":
      return `#${s.tag}`;
    case "kind":
      return KIND_WORDS[s.kind];
    case "list":
      return s.label || `${s.paths.length} picked`;
  }
}

export function actionVerb(a: Action): string {
  switch (a.type) {
    case "play":
      return "play";
    case "random":
      return "play a random one from";
    case "next":
      return "play the next one from";
    case "pause":
      return "pause wallpapers";
    case "resume":
      return "resume wallpapers";
    case "mute":
      return "mute sound";
    case "unmute":
      return "turn sound on";
    case "volume":
      return `set volume to ${a.level}%`;
  }
}

export function wallpaperName(path: string): string {
  return useStore.getState().library.find((w) => w.path === path)?.name ?? path.split(/[\\/]/).pop() ?? path;
}

export function changesWallpaper(a: Action): boolean {
  return a.type === "play" || a.type === "random" || a.type === "next";
}


export function title(a: Automation): string {
  if (a.name) return a.name;
  const what = a.action.type === "play" ? `Play ${wallpaperName(a.action.path)}` : a.action.type === "random" || a.action.type === "next" ? `${a.action.type === "random" ? "Random" : "Next"} from ${sourceText(a.action.source)}` : actionVerb(a.action)[0].toUpperCase() + actionVerb(a.action).slice(1);
  const when = triggerText(a.trigger);
  return `${what} ${when}`;
}


export function toMinutes(at: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!m) return null;
  const [h, mm] = [Number(m[1]), Number(m[2])];
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

export function fromMinutes(m: number): string {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}


export const weekday = (d: Date) => (d.getDay() + 6) % 7;


export function nextRun(a: Automation, now = new Date()): string | null {
  if (!a.enabled || a.trigger.type !== "at") return null;
  const at = toMinutes(a.trigger.time);
  if (at === null) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < 8; i++) {
    const day = (weekday(now) + i) % 7;
    if (a.days.length && !a.days.includes(day)) continue;
    if (i === 0 && at <= nowMin) continue;
    const when = i === 0 ? "today" : i === 1 ? "tomorrow" : DAY_NAMES[day].slice(0, 3);
    return `${when} ${a.trigger.time}`;
  }
  return null;
}

export function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}


const base = { name: "", enabled: true, days: [] as number[], screens: [] as string[], respect_manual: false, undo_after: false };

export interface Template {
  id: string;
  title: string;
  blurb: string;
  make(screens?: string[]): Omit<Automation, "id">[];
}

export const TEMPLATES: Template[] = [
  {
    id: "daynight",
    title: "Day & night",
    blurb: "Something bright in the morning, a night scene in the evening.",
    make: (screens = []) => [
      { ...base, screens, trigger: { type: "at", time: "07:00" }, action: { type: "random", source: { type: "favourites" }, same_everywhere: true }, respect_manual: true },
      { ...base, screens, trigger: { type: "at", time: "19:00" }, action: { type: "random", source: tagSource("night"), same_everywhere: true }, respect_manual: true },
    ],
  },
  {
    id: "hourly",
    title: "Fresh every hour",
    blurb: "A new random favourite each hour, while you're at the computer.",
    make: (screens = []) => [{ ...base, screens, trigger: { type: "every", minutes: 60 }, action: { type: "random", source: { type: "favourites" }, same_everywhere: false }, respect_manual: true }],
  },
  {
    id: "morning",
    title: "New one each morning",
    blurb: "Weekdays at 8, a surprise from everything you have.",
    make: (screens = []) => [{ ...base, screens, days: [0, 1, 2, 3, 4], trigger: { type: "at", time: "08:00" }, action: { type: "random", source: { type: "everything" }, same_everywhere: true }, respect_manual: true }],
  },
  {
    id: "weekend",
    title: "Weekend look",
    blurb: "Saturday and Sunday get their own wallpapers.",
    make: (screens = []) => [{ ...base, screens, days: [5, 6], trigger: { type: "at", time: "09:00" }, action: { type: "random", source: { type: "favourites" }, same_everywhere: true }, respect_manual: true }],
  },
  {
    id: "gaming",
    title: "Quiet while gaming",
    blurb: "Pause when Steam opens, carry on when it closes.",
    make: () => [{ ...base, trigger: { type: "app_opens", app: "steam" }, action: { type: "pause" }, undo_after: true }],
  },
  {
    id: "battery",
    title: "Save battery",
    blurb: "Pause on battery power, resume on the charger.",
    make: () => [{ ...base, trigger: { type: "on_battery" }, action: { type: "pause" }, undo_after: true }],
  },
  {
    id: "night-quiet",
    title: "Quiet nights",
    blurb: "Mute wallpaper sound at 23:00, back on at 8.",
    make: () => [
      { ...base, trigger: { type: "at", time: "23:00" }, action: { type: "mute" } },
      { ...base, trigger: { type: "at", time: "08:00" }, action: { type: "unmute" } },
    ],
  },
  {
    id: "login",
    title: "Surprise on login",
    blurb: "Every time you log in, a different favourite.",
    make: (screens = []) => [{ ...base, screens, trigger: { type: "startup" }, action: { type: "random", source: { type: "favourites" }, same_everywhere: true } }],
  },
];

export function blank(): Omit<Automation, "id"> {
  const now = new Date();
  return { ...base, trigger: { type: "at", time: fromMinutes(Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 15) * 15) }, action: { type: "random", source: { type: "favourites" }, same_everywhere: true }, respect_manual: true };
}


export function rotationFor(monitor: string): Automation | undefined {
  return all().find((a) => a.trigger.type === "every" && changesWallpaper(a.action) && a.screens.length === 1 && a.screens[0] === monitor);
}


export function rotateThrough(monitor: string, paths: string[], label: string, every = 60) {
  const source: Source = { type: "list", paths, label };
  const existing = rotationFor(monitor);
  let id: string;
  if (existing) {
    id = existing.id;
    update(id, { enabled: true, action: { type: existing.action.type === "random" ? "random" : "next", source } as Action });
  } else {
    [id] = add({ ...base, screens: [monitor], trigger: { type: "every", minutes: every }, action: { type: "next", source } });
  }
  useStore.getState().toast("ok", `${monitor} now changes every hour through “${label}”`, { label: "Edit", run: () => useStore.getState().setFocusAutomation(id) });
}


export function setRotateEvery(monitor: string, every: number | null) {
  const existing = rotationFor(monitor);
  if (every === null) return existing && update(existing.id, { enabled: false });
  if (existing) return update(existing.id, { enabled: true, trigger: { ...existing.trigger, type: "every", minutes: every } as Trigger });
  add({ ...base, screens: [monitor], trigger: { type: "every", minutes: every }, action: { type: "random", source: { type: "favourites" }, same_everywhere: true } });
}


export function forScreen(monitor: string): Automation[] {
  return all().filter((a) => a.enabled && changesWallpaper(a.action) && (!a.screens.length || a.screens.includes(monitor)));
}
