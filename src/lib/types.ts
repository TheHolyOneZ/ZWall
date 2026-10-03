

export type PauseReason = "none" | "user" | "fullscreen" | "covered" | "battery" | "app" | "idle" | "locked";

export interface Monitor {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
  wallpaper: string | null;

  span: string | null;
}

export type Motion = "mouse" | "drift" | "still";
export type Tint = "original" | "accent" | "mono";


export interface Params {
  speed: number;
  intensity: number;
  depth: number;
  motion: Motion;
  tint: Tint;

  volume: number;
  overlay: Overlay;
  overlay_amount: number;

  life: number;
}

export type Overlay = "none" | "rain" | "snow" | "fireflies" | "grain";

export const DEFAULT_PARAMS: Params = { speed: 1, intensity: 1, depth: 0, motion: "mouse", tint: "original", volume: 1, overlay: "none", overlay_amount: 1, life: 0 };


export interface Settings {
  fps_cap: number;

  web_fps: number;

  blend_edges: boolean;
  blend_strength: number;
  blend_width: number;
  quality: number;
  pause_fullscreen: boolean;
  pause_battery: boolean;
  pause_idle_minutes: number;
  volume: number;
  mute: boolean;
  interactive: boolean;
  pause_apps: string[];
  hotkeys: boolean;
  when_covered: "keep" | "calm" | "pause";
  battery_saver: boolean;
  follow_daylight: boolean;
  match_accent: boolean;
  screensaver_minutes: number;
  resume: boolean;
  pause_locked: boolean;
  duck_audio: boolean;
}


export interface UserCollection {
  id: string;
  name: string;
  paths: string[];
}


export interface Meta {
  title?: string;
  author?: string;
  source?: string;
  notes?: string;
  width?: number;
  height?: number;
}


export interface Widget {
  id: string;
  monitor: string;
  kind: "clock" | "date" | "text" | "system" | "battery";
  style: string;
  x: number;
  y: number;

  size: number;

  color: string;
  opacity: number;
  font: string;
  weight: number;
  effect: "none" | "shadow" | "glow";
  align: "left" | "center" | "right";
  hour24: boolean;
  seconds: boolean;
  text: string;
  metrics: string[];
}


export interface BlendLink {
  a: string;
  b: string;
  stacked: boolean;
  enabled: boolean;
  into_a: number;
  into_b: number;
  a_span: [number, number];
  b_span: [number, number];
  strength: number;
}

export interface BlendEdge {
  side: "left" | "right" | "top" | "bottom";
  image: string;
  size: number;
}


export interface Facts {
  width: number;
  height: number;
  bytes: number;
}


export type Trigger =
  | { type: "at"; time: string }
  | { type: "every"; minutes: number; from?: string; to?: string }
  | { type: "app_opens"; app: string }
  | { type: "on_battery" }
  | { type: "plugged_in" }
  | { type: "startup" };


export type Source =
  | { type: "everything" }
  | { type: "favourites" }
  | { type: "collection"; id: string }
  | { type: "tag"; tag: string; builtin?: string[] }
  | { type: "kind"; kind: Kind }
  | { type: "list"; paths: string[]; label?: string };

export type Action =
  | { type: "play"; path: string }
  | { type: "random"; source: Source; same_everywhere?: boolean }
  | { type: "next"; source: Source }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "volume"; level: number };


export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  action: Action;

  days: number[];

  screens: string[];

  respect_manual: boolean;

  undo_after: boolean;
}

export interface EngineState {
  protocol: number;
  backend: string;
  monitors: Monitor[];
  paused: PauseReason;
  settings: Settings;
  gpu: string | null;
  gpu_percent: number | null;
  params: Record<string, Params>;
  accent: string | null;

  thumbs: Record<string, string>;
  library: LibraryItem[];
  favourites: string[];
  tags: Record<string, string[]>;
  tag_list: string[];

  arrangement: Record<string, [number, number]>;
  widgets: Widget[];
  fonts: string[];
  blend_links: Record<string, BlendLink>;
  blend_pairs: BlendLink[];
  blends: Record<string, BlendEdge[]>;
  watches: Watch[];
  watch_status: Record<string, WatchStatus>;
  automations: Automation[];

  manual: Record<string, string>;

  automation_runs: Record<string, number>;
  collections: UserCollection[];
  meta: Record<string, Meta>;
  facts: Record<string, Facts>;
  also_live: string[];
  shortcuts: string[];

  resting: Record<string, string>;
  durations: Record<string, number>;
  depths: Record<string, string>;
  scenes: Record<string, { map: string; found: string[] }>;
  jobs: Record<string, string>;
}

export interface LibraryItem {
  path: string;
  name: string;
  kind: "photo" | "video" | "web";

  added?: number;

  from_watch?: string | null;
}


export interface Watch {
  id: string;
  path: string;
  enabled: boolean;
  recursive: boolean;

  kinds: string[];

  collection: string | null;
  tags: string[];

  prune: boolean;

  ignored: string[];
}

export interface WatchStatus {
  found: number;
  scanned: number;
  error?: string | null;
}

export type Request =
  | "GetState"
  | "Pause"
  | "Resume"
  | "Next"
  | { SetWallpaper: { path: string; monitors: string[] } }
  | { Span: { path: string; monitors: string[] } }
  | { Clear: { monitor: string } }
  | { SetSettings: Settings }
  | { SetParams: { path: string; params: Params } }
  | { MakePreview: { path: string } }
  | { AddToLibrary: LibraryItem }
  | { RemoveFromLibrary: { path: string } }
  | { SetFavourite: { path: string; on: boolean } }
  | { SetTags: { path: string; tags: string[] } }
  | { SetMeta: { path: string; meta: Meta } }
  | { ClearParams: { path: string } }
  | "Quit"
  | { SetWatches: Watch[] }
  | { SetArrangement: Record<string, [number, number]> }
  | { SetBlendLinks: Record<string, BlendLink> }
  | { SetWidgets: Widget[] }
  | "RescanWatches"
  | { SetAutomations: Automation[] }
  | { RunAutomation: { id: string } }
  | "ClearManual"
  | { SetCollections: UserCollection[] }
  | { SetTagList: string[] }
  | { SetAlsoLive: { path: string; on: boolean } }
  | { Export: { path: string; name?: string } }
  | { Import: { file: string } }
  | { MakeLoop: { path: string; start: number; end: number; crossfade: number; find_best: boolean } };

export type Kind = "shader" | "photo" | "video" | "web";

export interface Wallpaper {
  id: string;

  path: string;
  name: string;
  kind: Kind;

  look: Look;

  glow: [string, string];

  developing?: boolean;
  fav?: boolean;

  own?: boolean;

  tags: string[];

  added?: number;

  alsoLive?: boolean;

  fromWatch?: string;

  fileName?: string;

  meta?: Meta;

  width?: number;
  height?: number;
  bytes?: number;
}

export type Look = "web" | "aurora" | "starfield" | "rain" | "lava" | "fireflies" | "mesh" | "dunes" | "ocean" | "snow" | "ink" | "grain" | "crt" | "photo" | "video";
