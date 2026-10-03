

import { AnimatePresence, motion } from "motion/react";
import { Battery, Check, Clock, GripVertical, Image as ImageIcon, MoreHorizontal, Pause, Play, PlugZap, Plus, Power, Repeat, Search, Shuffle, ListOrdered, AppWindow, VolumeX, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { send } from "../lib/actions";
import * as auto from "../lib/automations";
import { KIND_LABEL } from "../lib/presets";
import { useReorder } from "../lib/reorder";
import { allTags } from "../lib/search";
import { type MenuItem, useStore, useThumb } from "../lib/store";
import type { Action, Automation, Kind, Source, Trigger, Wallpaper } from "../lib/types";
import { LookLayer, Preview } from "./Preview";
import { Switch } from "./ui/Switch";
import { Tip } from "./Tip";

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;


function poolOf(src: Source, library: Wallpaper[]): Wallpaper[] {
  const ready = library.filter((w) => !w.developing);
  const st = useStore.getState().engine;

  const found = picked(src, ready, st?.collections ?? []);
  if (found.length) return found;
  const favs = ready.filter((w) => w.fav);
  return favs.length && src.type !== "favourites" ? favs : ready;
}

function picked(src: Source, ready: Wallpaper[], cols: { id: string; paths: string[] }[]): Wallpaper[] {
  switch (src.type) {
    case "everything":
      return ready;
    case "favourites":
      return ready.filter((w) => w.fav);
    case "collection": {
      const paths = cols.find((c) => c.id === src.id)?.paths ?? [];
      return paths.map((p) => ready.find((w) => w.path === p)).filter((w): w is Wallpaper => !!w);
    }
    case "tag":
      return ready.filter((w) => w.tags.includes(src.tag));
    case "kind":
      return ready.filter((w) => w.kind === src.kind || (src.kind === "shader" && w.alsoLive));
    case "list":
      return src.paths.map((p) => ready.find((w) => w.path === p)).filter((w): w is Wallpaper => !!w);
  }
}

function openAt(e: React.MouseEvent, items: MenuItem[]) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  useStore.getState().openMenu(r.left, r.bottom + 4, items);
}

export function AutomateView() {
  const list = useStore((s) => s.engine?.automations) ?? [];
  const monitors = useStore((s) => s.engine?.monitors) ?? [];
  const manual = useStore((s) => s.engine?.manual) ?? {};
  const focus = useStore((s) => s.focusAutomation);
  const [day, setDay] = useState(() => auto.weekday(new Date()));
  const [picking, setPicking] = useState<{ onPick(w: Wallpaper): void } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const cards = useReorder(
    list.map((a) => a.id),
    { onOrder: (ids) => auto.save(ids.map((id) => list.find((a) => a.id === id)!)) },
  );


  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => {
      document.getElementById(`auto-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlash(focus);
      useStore.getState().setFocusAutomation(null);
      setTimeout(() => setFlash(null), 1600);
    }, 120);
    return () => clearTimeout(t);
  }, [focus, list.length]);

  const today = localDay();
  const pickedToday = monitors.filter((m) => manual[m.name] === today).map((m) => m.name);
  const respecting = list.some((a) => a.enabled && a.respect_manual && auto.changesWallpaper(a.action));
  const create = (...items: Omit<Automation, "id">[]) => {
    const [id] = auto.add(...items);
    useStore.getState().setFocusAutomation(id);
  };
  const newMenu = (e: React.MouseEvent) =>
    openAt(e, [
      { label: "Start from scratch", hint: "at a time", onSelect: () => create(auto.blank()) },
      { separator: true },
      { heading: true, label: "Starting points" },
      ...auto.TEMPLATES.map((t) => ({ label: t.title, hint: t.blurb.length > 34 ? undefined : t.blurb, onSelect: () => create(...t.make()) })),
    ]);

  return (
    <motion.div className="flex-1 min-h-0 overflow-y-auto scroll-fade px-4 pb-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <div className="max-w-[1100px] mx-auto flex flex-col gap-4">

        <section className="glass-pane rounded-[14px] px-4 pt-3 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="text-[13px] font-medium" style={{ color: "var(--text-2)" }}>
              {day === auto.weekday(new Date()) ? "Today" : auto.DAY_NAMES[day]}
            </div>
            <div className="flex gap-0.5" role="tablist" aria-label="Day to show">
              {auto.DAY_LETTERS.map((l, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={day === i}
                  title={auto.DAY_NAMES[i]}
                  className="w-[24px] h-[24px] rounded-[7px] text-[11px] font-semibold transition-colors"
                  style={{ background: day === i ? "var(--e3)" : undefined, color: day === i ? "var(--text)" : i === auto.weekday(new Date()) ? "var(--text-2)" : "var(--text-4)" }}
                  onClick={() => setDay(i)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <span className="text-[11px] hidden md:inline" style={{ color: "var(--text-4)" }}>
              Drag a moment to move it · double-click the line to add one
            </span>
            <button className="btn" onClick={newMenu}>
              <Plus size={13} /> New automation
            </button>
          </div>
          <DayLine list={list} day={day} onAdd={(time) => create({ ...auto.blank(), trigger: { type: "at", time } })} onFocus={(id) => useStore.getState().setFocusAutomation(id)} />
        </section>


        <AnimatePresence>
          {pickedToday.length > 0 && respecting && (
            <motion.div className="flex items-center gap-3 px-4 py-2.5 rounded-[12px] text-[12px]" style={{ background: "var(--e1)", boxShadow: "inset 0 0 0 1px var(--edge)", color: "var(--text-2)" }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Check size={14} style={{ color: "var(--text-3)" }} />
              <span className="flex-1">
                You picked {pickedToday.join(" and ")}'s wallpaper yourself today. Automations that leave hand-picked screens alone skip {pickedToday.length > 1 ? "them" : "it"} until tomorrow.
              </span>
              <button className="tbtn !h-[26px]" onClick={() => send("ClearManual")}>
                Let them run today
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {list.length === 0 ? (
          <Starters onPick={(t) => create(...t.make())} onBlank={() => create(auto.blank())} />
        ) : (
          <div ref={cards.listRef} className="flex flex-col gap-2">
            {list.map((a) => (
              <Card key={a.id} a={a} flash={flash === a.id} item={cards.item(a.id)} grip={cards.grip(a.id)} pick={(onPick) => setPicking({ onPick })} />
            ))}
          </div>
        )}
        {list.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center text-[12px]" style={{ color: "var(--text-3)" }}>
            <span className="mr-1">Add another:</span>
            {auto.TEMPLATES.map((t) => (
              <button key={t.id} className="tbtn !h-[26px] !px-2" style={{ background: "var(--e1)" }} title={t.blurb} onClick={() => create(...t.make())}>
                {t.title}
              </button>
            ))}
          </div>
        )}
      </div>
      <AnimatePresence>{picking && <Picker onPick={(w) => (picking.onPick(w), setPicking(null))} onClose={() => setPicking(null)} />}</AnimatePresence>
    </motion.div>
  );
}

function DayLine({ list, day, onAdd, onFocus }: { list: Automation[]; day: number; onAdd(time: string): void; onFocus(id: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; min: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const isToday = day === auto.weekday(now);
  const onDay = (a: Automation) => !a.days.length || a.days.includes(day);
  const timed = list
    .filter((a) => a.trigger.type === "at" && onDay(a))
    .map((a) => ({ a, min: drag?.id === a.id ? drag.min : (auto.toMinutes((a.trigger as { time: string }).time) ?? 0) }))
    .sort((x, y) => x.min - y.min);
  const lanes: number[] = [];
  const laneEnd: number[] = [];
  for (const { min } of timed) {
    let l = laneEnd.findIndex((end) => min - end >= 75);
    if (l < 0) l = laneEnd.length;
    laneEnd[l] = min;
    lanes.push(Math.min(l, 2));
  }
  const bands = list.filter((a) => a.trigger.type === "every" && onDay(a));
  const others = list.filter((a) => a.trigger.type !== "at" && a.trigger.type !== "every");
  const minAt = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.round((Math.max(0, Math.min(1, (x - r.left) / r.width)) * 1440) / 5) * 5;
  };
  const pct = (m: number) => `${(m / 1440) * 100}%`;
  const startDrag = (a: Automation, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return;
      moved = true;
      setDrag({ id: a.id, min: Math.min(1435, minAt(ev.clientX)) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moved) return onFocus(a.id);
      auto.update(a.id, { trigger: { type: "at", time: auto.fromMinutes(Math.min(1435, minAt(ev.clientX))) } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <div>
      <div
        ref={ref}
        className="relative h-[124px] select-none"
        onDoubleClick={(e) => (e.target as HTMLElement).closest("[data-marker]") || onAdd(auto.fromMinutes(minAt(e.clientX)))}
      >

        <div className="absolute left-0 right-0 bottom-[26px] h-[2px] rounded-full" style={{ background: "var(--e3)" }} />
        <div className="absolute bottom-[26px] h-[2px]" style={{ left: 0, width: pct(6 * 60), background: "var(--e1)" }} />
        <div className="absolute bottom-[26px] h-[2px]" style={{ left: pct(21 * 60), right: 0, background: "var(--e1)" }} />
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <div key={h} className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center" style={{ left: pct(h * 60) }}>
            <span className="w-px h-[6px] mb-1" style={{ background: "var(--edge)" }} />
            <span className="mono text-[10px]" style={{ color: "var(--text-4)" }}>{String(h % 24).padStart(2, "0")}</span>
          </div>
        ))}

        {bands.map((a, i) => {
          const t = a.trigger as Extract<Trigger, { type: "every" }>;
          const from = auto.toMinutes(t.from ?? "") ?? 0;
          const to = auto.toMinutes(t.to ?? "") ?? 1440;
          const len = from < to ? to - from : 1440 - from + to;
          const step = Math.max(t.minutes, 15);
          const ticks: number[] = [];
          for (let m = 0; m < len && ticks.length < 96; m += step) ticks.push((from + m) % 1440);
          return (
            <button
              key={a.id}
              data-marker
              className="absolute left-0 right-0 h-[10px] group/b"
              style={{ bottom: 30 + i * 12, opacity: a.enabled ? 1 : 0.4 }}
              title={auto.title(a)}
              onClick={() => onFocus(a.id)}
            >
              {ticks.map((m) => (
                <span key={m} className="absolute top-0 w-[2px] h-[8px] rounded-full -ml-px transition-colors group-hover/b:bg-[var(--text)]" style={{ left: pct(m), background: "var(--text-3)" }} />
              ))}
            </button>
          );
        })}
        {isToday && (
          <div className="absolute top-0 bottom-[22px] w-px pointer-events-none" style={{ left: pct(nowMin), background: "var(--text-2)" }}>
            <span className="absolute -top-0.5 left-1 text-[10px] font-medium" style={{ color: "var(--text-2)" }}>now</span>
          </div>
        )}
        {timed.map(({ a, min }, i) => (
          <div
            key={a.id}
            data-marker
            className="absolute -translate-x-1/2 flex flex-col items-center cursor-grab active:cursor-grabbing"
            style={{ left: pct(min), bottom: 28, zIndex: drag?.id === a.id ? 5 : 1 }}
            onPointerDown={(e) => startDrag(a, e)}
          >
            <div className="flex flex-col items-center">
              <Marker a={a} />
              <span className="mono text-[10px] mt-0.5 px-1 rounded-[4px]" style={{ color: drag?.id === a.id ? "var(--text)" : "var(--text-3)", background: drag?.id === a.id ? "var(--e3)" : undefined }}>
                {auto.fromMinutes(min)}
              </span>
            </div>
            <span className="w-px" style={{ height: 6 + lanes[i] * 44, background: a.enabled ? "var(--text-3)" : "var(--edge)" }} />
          </div>
        ))}
        {timed.length === 0 && bands.length === 0 && (
          <div className="absolute inset-x-0 top-6 text-center text-[12px] pointer-events-none" style={{ color: "var(--text-4)" }}>
            Nothing happens at set times {day === auto.weekday(now) ? "today" : `on ${auto.DAY_NAMES[day]}s`}. Double-click the line to add something.
          </div>
        )}
      </div>
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[12px]" style={{ color: "var(--text-3)" }}>
          <span className="mr-0.5">Also</span>
          {others.map((a) => (
            <button key={a.id} className="tbtn !h-[24px] !px-2" style={{ background: "var(--e1)", opacity: a.enabled ? 1 : 0.5 }} onClick={() => onFocus(a.id)}>
              <TriggerIcon t={a.trigger} /> {auto.triggerText(a.trigger)} → {auto.actionVerb(a.action).replace(/ from$/, "")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


function Marker({ a }: { a: Automation }) {
  const library = useStore((s) => s.library);
  const box = "w-[52px] h-[30px] rounded-[7px] overflow-hidden relative";
  const ring = { boxShadow: `0 0 0 1px ${a.enabled ? "rgba(255,255,255,.18)" : "var(--edge)"}, 0 4px 12px rgba(0,0,0,.35)`, opacity: a.enabled ? 1 : 0.45 };
  if (a.action.type === "play") {
    const w = library.find((x) => x.path === (a.action as { path: string }).path);
    return (
      <div className={box} style={{ ...ring, background: "#0b0b0f" }}>
        {w && <Thumb w={w} />}
      </div>
    );
  }
  if (a.action.type === "random" || a.action.type === "next") {
    const pool = poolOf(a.action.source, library).slice(0, 3);
    return (
      <div className="relative w-[58px] h-[34px]" style={{ opacity: ring.opacity }}>
        {pool.map((w, i) => (
          <div key={w.id} className="absolute w-[44px] h-[25px] rounded-[6px] overflow-hidden" style={{ left: i * 7, top: 9 - i * 4.5, zIndex: i, background: "#0b0b0f", boxShadow: "0 0 0 1px rgba(255,255,255,.16), 0 3px 8px rgba(0,0,0,.4)" }}>
            <Thumb w={w} />
          </div>
        ))}
        <span className="absolute right-0 bottom-0 z-10 w-[16px] h-[16px] rounded-[5px] grid place-items-center" style={{ background: "var(--panel-2)", color: "var(--text-2)", boxShadow: "0 0 0 1px var(--edge)" }}>
          {a.action.type === "random" ? <Shuffle size={10} /> : <ListOrdered size={10} />}
        </span>
      </div>
    );
  }
  return (
    <div className={`${box} grid place-items-center`} style={{ ...ring, background: "var(--e2)", color: "var(--text-2)" }}>
      <ActionIcon a={a.action} />
    </div>
  );
}

function Thumb({ w }: { w: Wallpaper }) {
  const src = useThumb(w);
  return (
    <LookLayer path={w.path}>
      <Preview look={w.look} src={src} paused />
    </LookLayer>
  );
}

function TriggerIcon({ t, size = 12 }: { t: Trigger; size?: number }) {
  const I = t.type === "at" ? Clock : t.type === "every" ? Repeat : t.type === "app_opens" ? AppWindow : t.type === "on_battery" ? Battery : t.type === "plugged_in" ? PlugZap : Power;
  return <I size={size} />;
}

function ActionIcon({ a, size = 13 }: { a: Action; size?: number }) {
  const I = a.type === "pause" ? Pause : a.type === "resume" ? Play : a.type === "mute" ? VolumeX : a.type === "unmute" || a.type === "volume" ? Volume2 : a.type === "random" ? Shuffle : a.type === "next" ? ListOrdered : ImageIcon;
  return <I size={size} />;
}


function Card({ a, flash, item, grip, pick }: { a: Automation; flash: boolean; item: ReturnType<ReturnType<typeof useReorder>["item"]>; grip: ReturnType<ReturnType<typeof useReorder>["grip"]>; pick(onPick: (w: Wallpaper) => void): void }) {
  const monitors = useStore((s) => s.engine?.monitors) ?? [];
  const library = useStore((s) => s.library);
  const runs = useStore((s) => s.engine?.automation_runs?.[a.id]);
  const manual = useStore((s) => s.engine?.manual) ?? {};
  const created = useStore((s) => s.engine?.tag_list);
  const cols = useStore((s) => s.engine?.collections) ?? [];
  const set = (patch: Partial<Automation>) => auto.update(a.id, patch);
  const ask = useStore.getState().ask;
  const t = a.trigger;
  const act = a.action;
  const wall = auto.changesWallpaper(act);


  const triggerMenu: MenuItem[] = [
    { label: "At a time of day", checked: t.type === "at", onSelect: () => set({ trigger: { type: "at", time: t.type === "at" ? t.time : "08:00" } }) },
    { label: "Every so often", checked: t.type === "every", onSelect: () => set({ trigger: { type: "every", minutes: 60 } }) },
    { label: "When an app opens", checked: t.type === "app_opens", onSelect: () => askApp((app) => set({ trigger: { type: "app_opens", app }, undo_after: true })) },
    { label: "When the charger is unplugged", checked: t.type === "on_battery", onSelect: () => set({ trigger: { type: "on_battery" }, undo_after: true }) },
    { label: "When the charger is plugged in", checked: t.type === "plugged_in", onSelect: () => set({ trigger: { type: "plugged_in" } }) },
    { label: "When ZWall starts", hint: "after login", checked: t.type === "startup", onSelect: () => set({ trigger: { type: "startup" } }) },
  ];
  const askApp = (then: (app: string) => void) =>
    ask({ title: "Which app?", value: t.type === "app_opens" ? t.app : "", placeholder: "Its program name, e.g. steam, obs, code, firefox", confirm: "Use it", onConfirm: (v) => v.trim() && then(v.trim().toLowerCase()) });
  const everyMenu: MenuItem[] = [
    ...[5, 15, 30, 60, 120, 360, 1440].map((m) => ({ label: auto.everyText(m).replace(/^every /, "Every "), checked: t.type === "every" && t.minutes === m, onSelect: () => set({ trigger: { ...(t as Extract<Trigger, { type: "every" }>), minutes: m } }) })),
    {
      label: "Custom…",
      onSelect: () =>
        ask({ title: "Every how many minutes?", value: String(t.type === "every" ? t.minutes : 60), placeholder: "e.g. 45", confirm: "Set", onConfirm: (v) => Number(v) > 0 && set({ trigger: { ...(t as Extract<Trigger, { type: "every" }>), minutes: Math.round(Number(v)) } }) }),
    },
  ];
  const windowMenu: MenuItem[] = (
    [
      ["", "", "All day"],
      ["08:00", "20:00", "Daytime (8–20)"],
      ["09:00", "17:00", "Work hours (9–17)"],
      ["18:00", "23:59", "Evenings (18–24)"],
    ] as const
  )
    .map(([from, to, label]): MenuItem => ({ label, checked: t.type === "every" && (t.from ?? "") === from && (t.to ?? "") === to, onSelect: () => set({ trigger: { ...(t as Extract<Trigger, { type: "every" }>), from, to } }) }))
    .concat({
      label: "Custom…",
      onSelect: () =>
        ask({
          title: "Between which times?",
          value: t.type === "every" && t.from ? `${t.from}-${t.to}` : "09:00-17:00",
          placeholder: "e.g. 09:00-17:00",
          confirm: "Set",
          onConfirm: (v) => {
            const [from, to] = v.split(/\s*[-–]\s*/);
            if (auto.toMinutes(from ?? "") !== null && auto.toMinutes(to ?? "") !== null) set({ trigger: { ...(t as Extract<Trigger, { type: "every" }>), from, to } });
          },
        }),
    });
  const daysMenu: MenuItem[] = [
    { label: "Every day", checked: !a.days.length || a.days.length === 7, onSelect: () => set({ days: [] }) },
    { label: "Weekdays", checked: a.days.join() === "0,1,2,3,4", onSelect: () => set({ days: [0, 1, 2, 3, 4] }) },
    { label: "Weekends", checked: a.days.join() === "5,6", onSelect: () => set({ days: [5, 6] }) },
    { separator: true },
    ...auto.DAY_NAMES.map((n, i) => ({ label: n, checked: a.days.includes(i), onSelect: () => set({ days: a.days.includes(i) ? a.days.filter((d) => d !== i) : [...a.days, i].sort() }) })),
  ];
  const screensMenu: MenuItem[] = [
    { label: "All screens", checked: !a.screens.length, onSelect: () => set({ screens: [] }) },
    { separator: true },
    ...monitors.map((m) => {
      const on = a.screens.includes(m.name);
      return { label: m.name, hint: `${m.width}×${m.height}`, checked: on, onSelect: () => set({ screens: on ? a.screens.filter((s) => s !== m.name) : [...a.screens, m.name] }) };
    }),
  ];
  const tags = allTags(library, created ?? []);
  const sourceItems = (make: (s: Source) => Action): MenuItem[] => [
    { label: "Favourites", onSelect: () => set({ action: make({ type: "favourites" }) }) },
    { label: "Everything", onSelect: () => set({ action: make({ type: "everything" }) }) },
    { label: "A collection", disabled: !cols.length, submenu: cols.map((c) => ({ label: c.name, hint: String(c.paths.length), onSelect: () => set({ action: make({ type: "collection", id: c.id }) }) })) },
    { label: "A tag", disabled: !tags.length, submenu: tags.map(([tag, n]) => ({ label: tag, hint: String(n), onSelect: () => set({ action: make(auto.tagSource(tag)) }) })) },
    { label: "A type", submenu: (["shader", "photo", "video", "web"] as Kind[]).map((k) => ({ label: KIND_LABEL[k], onSelect: () => set({ action: make({ type: "kind", kind: k }) }) })) },
  ];
  const currentSource: Source = act.type === "random" || act.type === "next" ? act.source : { type: "favourites" };
  const actionMenu: MenuItem[] = [
    { label: "Play a wallpaper…", checked: act.type === "play", onSelect: () => pick((w) => set({ action: { type: "play", path: w.path } })) },
    { label: "Play a random one", checked: act.type === "random", onSelect: () => set({ action: { type: "random", source: currentSource, same_everywhere: true } }) },
    { label: "Play the next one", hint: "in order", checked: act.type === "next", onSelect: () => set({ action: { type: "next", source: currentSource } }) },
    { separator: true },
    { label: "Pause wallpapers", checked: act.type === "pause", onSelect: () => set({ action: { type: "pause" } }) },
    { label: "Resume wallpapers", checked: act.type === "resume", onSelect: () => set({ action: { type: "resume" } }) },
    { label: "Mute sound", checked: act.type === "mute", onSelect: () => set({ action: { type: "mute" } }) },
    { label: "Turn sound on", checked: act.type === "unmute", onSelect: () => set({ action: { type: "unmute" } }) },
    { label: "Set the volume", checked: act.type === "volume", submenu: [10, 25, 50, 75, 100].map((level) => ({ label: `${level}%`, checked: act.type === "volume" && act.level === level, onSelect: () => set({ action: { type: "volume", level } }) })) },
  ];
  const moreMenu: MenuItem[] = [
    { label: "Run it now", onSelect: () => send({ RunAutomation: { id: a.id } }) },
    { label: "Rename…", onSelect: () => ask({ title: "Name this automation", value: a.name, placeholder: auto.title({ ...a, name: "" }), confirm: "Save", onConfirm: (name) => set({ name }) }) },
    { label: "Duplicate", onSelect: () => auto.duplicate(a.id) },
    { separator: true },
    { label: "Delete", danger: true, onSelect: () => auto.remove(a.id) },
  ];


  const resting = wall && a.respect_manual ? monitors.filter((m) => (!a.screens.length || a.screens.includes(m.name)) && manual[m.name] === localDay()).map((m) => m.name) : [];
  const next = auto.nextRun(a);
  const status = !a.enabled ? "Off" : resting.length && resting.length === (a.screens.length || monitors.length) ? "Resting today: picked by hand" : next ? `Next: ${next}` : runs ? `Ran ${auto.ago(runs)}` : t.type === "every" ? "Waiting for its first turn" : "Waiting";

  const pool = act.type === "random" || act.type === "next" ? poolOf(act.source, library) : [];
  const played = act.type === "play" ? library.find((w) => w.path === act.path) : undefined;
  const multi = a.screens.length !== 1 && monitors.length > 1;

  return (
    <motion.article
      id={`auto-${a.id}`}
      {...item}
      className="glass-pane rounded-[14px] px-3 py-3 flex gap-3"
      animate={{ boxShadow: flash ? "0 0 0 2px var(--accent)" : "0 0 0 0px rgba(0,0,0,0)" }}
      transition={{ duration: 0.25 }}
    >
      <button {...grip} className="self-stretch -my-1 px-0.5 cursor-grab active:cursor-grabbing rounded-[6px] hover:bg-[var(--e1)]" aria-label="Drag to reorder" title="Drag to reorder" style={{ color: "var(--text-4)" }}>
        <GripVertical size={14} />
      </button>
      <div className="pt-[3px]">
        <Switch on={a.enabled} label={a.enabled ? "Turn off" : "Turn on"} onChange={(enabled) => set({ enabled })} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2.5" style={{ opacity: a.enabled ? 1 : 0.55 }}>
        {a.name && <div className="text-[12px] font-semibold -mb-1" style={{ color: "var(--text-2)" }}>{a.name}</div>}

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[14px] leading-[26px]" style={{ color: "var(--text-3)" }}>
          <Word onClick={(e) => openAt(e, triggerMenu)} icon={<TriggerIcon t={t} />}>
            {t.type === "at" ? "At" : t.type === "every" ? "Every" : t.type === "app_opens" ? "When" : t.type === "startup" ? "When ZWall starts" : t.type === "on_battery" ? "When unplugged" : "When plugged in"}
          </Word>
          {t.type === "at" && <TimeWord value={t.time} onChange={(time) => set({ trigger: { type: "at", time } })} />}
          {t.type === "every" && (
            <>
              <Word onClick={(e) => openAt(e, everyMenu)}>{auto.everyText(t.minutes).replace(/^every /, "")}</Word>
              <Word onClick={(e) => openAt(e, windowMenu)} quiet={!t.from}>
                {t.from ? `between ${t.from}–${t.to}` : "all day"}
              </Word>
            </>
          )}
          {t.type === "app_opens" && (
            <>
              <Word onClick={() => askApp((app) => set({ trigger: { type: "app_opens", app } }))}>{t.app || "an app"}</Word>
              <span>opens</span>
            </>
          )}
          <Word onClick={(e) => openAt(e, daysMenu)} quiet={!a.days.length}>
            {auto.daysText(a.days)}
          </Word>
          {wall && (
            <>
              <span>on</span>
              <Word onClick={(e) => openAt(e, screensMenu)} quiet={!a.screens.length}>
                {a.screens.length ? a.screens.join(" + ") : "all screens"}
              </Word>
            </>
          )}
          <span className="w-1" />
          <Word onClick={(e) => openAt(e, actionMenu)} icon={<ActionIcon a={act} size={12} />}>
            {auto.actionVerb(act)}
          </Word>
          {act.type === "play" && (
            <Word onClick={() => pick((w) => set({ action: { type: "play", path: w.path } }))} thumb={played}>
              {played?.name ?? auto.wallpaperName(act.path)}
            </Word>
          )}
          {(act.type === "random" || act.type === "next") && (
            <Word onClick={(e) => openAt(e, sourceItems((source) => (act.type === "random" ? { ...act, source } : { type: "next", source })))} fan={pool}>
              {auto.sourceText(act.source)}
            </Word>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]" style={{ color: "var(--text-3)" }}>
          <div className="flex gap-0.5" aria-label="Days">
            {auto.DAY_LETTERS.map((l, i) => {
              const on = !a.days.length || a.days.includes(i);
              return (
                <button
                  key={i}
                  title={auto.DAY_NAMES[i]}
                  aria-pressed={on}
                  className="w-[22px] h-[22px] rounded-[6px] text-[11px] font-semibold transition-colors hover:bg-[var(--e3)]"
                  style={{ background: on ? "var(--e2)" : undefined, color: on ? "var(--text)" : "var(--text-4)" }}
                  onClick={() => {
                    const cur = a.days.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
                    const next = cur.includes(i) ? cur.filter((d) => d !== i) : [...cur, i].sort();
                    set({ days: next.length === 7 ? [] : next.length ? next : [i] });
                  }}
                >
                  {l}
                </button>
              );
            })}
          </div>
          {wall && <Tick on={a.respect_manual} onChange={(respect_manual) => set({ respect_manual })} label="Leave screens I picked by hand alone that day" />}
          {act.type === "random" && multi && <Tick on={act.same_everywhere !== false} onChange={(same) => set({ action: { ...act, same_everywhere: same } })} label="Same one on every screen" />}
          {(t.type === "app_opens" || t.type === "on_battery" || t.type === "plugged_in") && (
            <Tick on={a.undo_after} onChange={(undo_after) => set({ undo_after })} label={t.type === "app_opens" ? "Put things back when it closes" : "Put things back when the power changes back"} />
          )}
          {pool.length > 0 && (
            <span style={{ color: "var(--text-4)" }}>
              {(act.type === "random" || act.type === "next") && !picked(act.source, library.filter((w) => !w.developing), cols).length
                ? `${auto.sourceText(act.source)} is empty for now, so it picks from ${pool.length === library.filter((w) => !w.developing).length ? "everything" : "your favourites"}`
                : `${pool.length} to pick from`}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1">
          <Tip label="Do it now, to see what it does">
            <button className="tbtn !h-[28px] gap-1.5" onClick={() => send({ RunAutomation: { id: a.id } })}>
              <Play size={12} /> Try it
            </button>
          </Tip>
          <button className="tbtn !h-[28px] !px-1.5" aria-label="More" onClick={(e) => openAt(e, moreMenu)}>
            <MoreHorizontal size={15} />
          </button>
        </div>
        <span className="text-[11px] whitespace-nowrap" style={{ color: "var(--text-4)" }}>{status}</span>
      </div>
    </motion.article>
  );
}


function Word({ children, onClick, icon, quiet, thumb, fan }: { children: React.ReactNode; onClick(e: React.MouseEvent): void; icon?: React.ReactNode; quiet?: boolean; thumb?: Wallpaper; fan?: Wallpaper[] }) {
  return (
    <button
      className="inline-flex items-center gap-1.5 h-[26px] px-2 rounded-[7px] font-medium transition-colors hover:bg-[var(--e3)]"
      style={{ background: "var(--e2)", color: quiet ? "var(--text-2)" : "var(--text)" }}
      onClick={onClick}
    >
      {thumb && (
        <span className="w-[28px] h-[16px] rounded-[4px] overflow-hidden relative -ml-1" style={{ background: "#0b0b0f" }}>
          <Thumb w={thumb} />
        </span>
      )}
      {fan && fan.length > 0 && (
        <span className="relative h-[16px] -ml-1" style={{ width: 22 + Math.min(fan.length, 3) * 5 }}>
          {fan.slice(0, 3).map((w, i) => (
            <span key={w.id} className="absolute top-0 w-[26px] h-[16px] rounded-[4px] overflow-hidden" style={{ left: i * 5, zIndex: i, background: "#0b0b0f", boxShadow: "0 0 0 1px rgba(0,0,0,.5)" }}>
              <Thumb w={w} />
            </span>
          ))}
        </span>
      )}
      {icon && <span style={{ color: "var(--text-3)" }}>{icon}</span>}
      {children}
    </button>
  );
}


function TimeWord({ value, onChange }: { value: string; onChange(v: string): void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setDraft(value), [value]);
  const nudge = (by: number) => {
    setDraft((d) => {
      const next = auto.fromMinutes(Math.round(((auto.toMinutes(d) ?? 0) + by) / 5) * 5);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => onChange(next), 450);
      return next;
    });
  };
  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      nudge(e.deltaY < 0 ? 5 : -5);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  const commit = () => {
    const m = auto.toMinutes(draft.replace(/[.h]/, ":"));
    if (m === null) return setDraft(value);
    const v = auto.fromMinutes(m);
    setDraft(v);
    if (v !== value) onChange(v);
  };
  return (
    <input
      ref={ref}
      aria-label="Time"
      title="Type a time, or scroll over it"
      className="mono w-[62px] h-[26px] px-2 rounded-[7px] text-[14px] font-medium text-center outline-none transition-colors hover:bg-[var(--e3)] focus:bg-[var(--e3)]"
      style={{ background: "var(--e2)", color: "var(--text)" }}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d:.h]/g, "").slice(0, 5))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "ArrowUp") (e.preventDefault(), nudge(5));
        if (e.key === "ArrowDown") (e.preventDefault(), nudge(-5));
        if (e.key === "Escape") (setDraft(value), (e.target as HTMLElement).blur());
      }}
    />
  );
}

function Tick({ on, label, onChange }: { on: boolean; label: string; onChange(v: boolean): void }) {
  return (
    <button className="inline-flex items-center gap-1.5 hover:text-[var(--text-2)] transition-colors" role="checkbox" aria-checked={on} onClick={() => onChange(!on)} style={{ color: on ? "var(--text-2)" : undefined }}>
      <span className="w-[14px] h-[14px] rounded-[4px] grid place-items-center transition-colors" style={{ background: on ? "var(--accent)" : "transparent", boxShadow: on ? undefined : "inset 0 0 0 1.5px var(--text-4)", color: "var(--accent-ink)" }}>
        {on && <Check size={10} strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}


function Starters({ onPick, onBlank }: { onPick(t: auto.Template): void; onBlank(): void }) {
  const icons: Record<string, typeof Clock> = { daynight: Clock, hourly: Repeat, morning: Shuffle, weekend: Clock, gaming: AppWindow, battery: Battery, "night-quiet": VolumeX, login: Power };
  return (
    <section>
      <div className="text-[13px] mb-1" style={{ color: "var(--text-2)" }}>Let your wallpaper change by itself</div>
      <div className="text-[12px] mb-3" style={{ color: "var(--text-3)" }}>
        Pick a starting point; everything in it can be changed afterwards. Or <button className="underline underline-offset-2 hover:text-[var(--text)]" onClick={onBlank}>start from scratch</button>.
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {auto.TEMPLATES.map((t) => {
          const I = icons[t.id] ?? Clock;
          return (
            <motion.button key={t.id} whileTap={{ scale: 0.98 }} className="glass-pane rounded-[12px] p-3 text-left flex gap-3 items-start transition-colors hover:bg-[var(--e1)]" onClick={() => onPick(t)}>
              <span className="w-[28px] h-[28px] rounded-[8px] grid place-items-center shrink-0" style={{ background: "var(--e2)", color: "var(--text-2)" }}>
                <I size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium" style={{ color: "var(--text)" }}>{t.title}</span>
                <span className="block text-[12px] leading-[1.45] mt-0.5" style={{ color: "var(--text-3)" }}>{t.blurb}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}


function Picker({ onPick, onClose }: { onPick(w: Wallpaper): void; onClose(): void }) {
  const library = useStore((s) => s.library);
  const [q, setQ] = useState("");
  const shown = useMemo(() => library.filter((w) => !w.developing && (!q || `${w.name} ${w.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [library, q]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <motion.div className="fixed inset-0 z-[60] grid place-items-center p-6" style={{ background: "rgba(5,5,8,.22)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div role="dialog" aria-label="Pick a wallpaper" className="glass-3 rounded-[16px] w-[min(760px,100%)] h-[min(560px,100%)] flex flex-col overflow-hidden" initial={{ scale: 0.97, y: 6 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.98, opacity: 0 }}>
        <div className="flex items-center gap-2 p-3 border-b" style={{ borderColor: "var(--edge)" }}>
          <Search size={14} style={{ color: "var(--text-3)" }} />
          <input autoFocus className="flex-1 bg-transparent outline-none text-[14px]" style={{ color: "var(--text)" }} placeholder="Pick a wallpaper" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="tbtn !px-1.5" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 grid gap-2.5 content-start" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {shown.map((w) => (
            <button key={w.id} className="group text-left" onClick={() => onPick(w)}>
              <div className="aspect-video rounded-[9px] overflow-hidden relative transition-shadow group-hover:shadow-[0_0_0_2px_var(--accent)]" style={{ background: "#0b0b0f" }}>
                <Thumb w={w} />
              </div>
              <div className="text-[12px] mt-1 truncate" style={{ color: "var(--text-2)" }}>{w.name}</div>
            </button>
          ))}
          {shown.length === 0 && <div className="col-span-full text-center text-[12px] py-10" style={{ color: "var(--text-3)" }}>Nothing matches “{q}”.</div>}
        </div>
      </motion.div>
    </motion.div>
  );
}
