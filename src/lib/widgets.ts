

import { send } from "./actions";
import { useStore } from "./store";
import type { Widget } from "./types";

export const all = (): Widget[] => useStore.getState().engine?.widgets ?? [];
export const save = (list: Widget[]) => send({ SetWidgets: list });

export function update(id: string, patch: Partial<Widget>) {
  save(all().map((w) => (w.id === id ? { ...w, ...patch } : w)));
}

export function remove(id: string) {
  const before = all();
  save(before.filter((w) => w.id !== id));
  useStore.getState().editWidget(null);
  useStore.getState().toast("ok", "Widget removed", { label: "Undo", run: () => save(before) });
}

export function duplicate(id: string) {
  const w = all().find((x) => x.id === id);
  if (!w) return;
  const copy = { ...w, id: newId(), y: Math.min(0.95, w.y + 0.08) };
  save([...all(), copy]);
  useStore.getState().editWidget(copy.id);
}

const newId = () => Math.random().toString(36).slice(2, 10);

const BASE: Omit<Widget, "id" | "monitor" | "kind"> = {
  style: "digital",
  x: 0.5,
  y: 0.4,
  size: 0.08,
  color: "#f3efe6",
  opacity: 0.95,
  font: "",
  weight: 300,
  effect: "shadow",
  align: "center",
  hour24: true,
  seconds: false,
  text: "",
  metrics: ["cpu", "ram"],
};

export const KINDS: [Widget["kind"], string][] = [
  ["clock", "Clock"],
  ["date", "Date"],
  ["text", "Text"],
  ["system", "System info"],
  ["battery", "Battery"],
];

export function add(kind: Widget["kind"], monitor: string) {
  const mine = all().filter((w) => w.monitor === monitor).length;
  const w: Widget = {
    ...BASE,
    id: newId(),
    monitor,
    kind,
    style: kind === "date" ? "long" : "digital",
    size: kind === "clock" ? 0.09 : kind === "text" ? 0.06 : 0.05,
    y: Math.min(0.9, 0.35 + mine * 0.12),
    text: kind === "text" ? "Your words here" : "",
  };
  save([...all(), w]);
  useStore.getState().editWidget(w.id);
}


export const SCHEMES: [string, string, Widget["effect"]][] = [
  ["Ivory", "#f3efe6", "shadow"],
  ["Snow", "#ffffff", "shadow"],
  ["Ice", "#bfe6ff", "glow"],
  ["Neon", "#5ef0ff", "glow"],
  ["Sakura", "#ffb3cf", "glow"],
  ["Ember", "#ffb36b", "glow"],
  ["Mint", "#9ff2c6", "shadow"],
  ["Ink", "#141418", "none"],
];


const pad = (n: number) => String(n).padStart(2, "0");
const WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export function words(d: Date): string {
  let m = Math.round(d.getMinutes() / 5) * 5;
  let h = d.getHours() % 12;
  if (m === 60) (m = 0), (h = (h + 1) % 12);
  const names: Record<number, string> = { 5: "five", 10: "ten", 15: "quarter", 20: "twenty", 25: "twenty-five", 30: "half" };
  if (m === 0) return `${WORDS[h]} o'clock`;
  if (m <= 30) return `${names[m]} past ${WORDS[h]}`;
  return `${names[60 - m]} to ${WORDS[(h + 1) % 12]}`;
}

export function text(w: Widget, d: Date): string {
  if (w.kind === "clock") {
    if (w.style === "words") return words(d);
    let h = d.getHours();
    let suffix = "";
    if (!w.hour24) (suffix = h < 12 ? " am" : " pm"), (h = h % 12 || 12);
    const t = `${w.hour24 ? pad(h) : h}:${pad(d.getMinutes())}${w.seconds ? `:${pad(d.getSeconds())}` : ""}`;
    return w.style === "minimal" ? t : t + suffix;
  }
  if (w.kind === "date") {
    if (w.style === "short") return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    const day = d.toLocaleDateString(undefined, { weekday: "long" });
    if (w.style === "weekday") return day;
    return `${day}, ${d.getDate()} ${d.toLocaleDateString(undefined, { month: "long" })}`;
  }

  if (w.kind === "system") {
    const out = [];
    if (w.metrics.includes("cpu")) out.push("CPU 12%");
    if (w.metrics.includes("ram")) out.push("RAM 9.4 / 32 GB");
    if (w.metrics.includes("uptime")) out.push("Up 2d 5h");
    return out.join(w.align === "center" ? "  ·  " : "\n");
  }
  if (w.kind === "battery") return "86%";
  return w.text;
}
