

import type { Wallpaper } from "./types";

export const PRESETS: Wallpaper[] = [
  { id: "aurora", path: "preset://aurora", name: "Aurora", kind: "shader", look: "aurora", glow: ["#22d3a6", "#6d5bff"], tags: ["night", "sky", "nature", "calm", "green"] },
  { id: "dunes", path: "preset://dunes", name: "Dunes at dusk", kind: "shader", look: "dunes", glow: ["#ff8a4c", "#8f3dff"], tags: ["desert", "sunset", "landscape", "warm", "calm"] },
  { id: "rain", path: "preset://rain", name: "Rain on glass", kind: "shader", look: "rain", glow: ["#4b7bff", "#1b2a4a"], tags: ["rain", "city", "night", "cosy", "bokeh"] },
  { id: "starfield", path: "preset://starfield", name: "Starfield", kind: "shader", look: "starfield", glow: ["#8aa4ff", "#2a1f5c"], tags: ["space", "stars", "night", "calm"] },
  { id: "lava", path: "preset://lava", name: "Lava", kind: "shader", look: "lava", glow: ["#ff5a36", "#ffb020"], tags: ["abstract", "fire", "warm", "bold"] },
  { id: "ocean", path: "preset://ocean", name: "Night swell", kind: "shader", look: "ocean", glow: ["#1fb6ff", "#0b3d6b"], tags: ["sea", "night", "moon", "calm"] },
  { id: "fireflies", path: "preset://fireflies", name: "Fireflies", kind: "shader", look: "fireflies", glow: ["#e8ff6a", "#1f4d2e"], tags: ["forest", "night", "nature", "magical"] },
  { id: "mesh", path: "preset://mesh", name: "Gradient mesh", kind: "shader", look: "mesh", glow: ["#ff7a59", "#c94bff"], tags: ["abstract", "gradient", "colourful", "minimal"] },
  { id: "snow", path: "preset://snow", name: "First snow", kind: "shader", look: "snow", glow: ["#9fb4d8", "#2a3348"], tags: ["winter", "snow", "night", "calm"] },
  { id: "ink", path: "preset://ink", name: "Ink in water", kind: "shader", look: "ink", glow: ["#e9e1d2", "#1e2d5a"], tags: ["abstract", "ink", "art", "flowing"] },
  { id: "grain", path: "preset://grain", name: "Grain", kind: "shader", look: "grain", glow: ["#d6785a", "#2a3346"], tags: ["minimal", "gradient", "film", "calm"] },
  { id: "crt", path: "preset://crt", name: "Phosphor", kind: "shader", look: "crt", glow: ["#1aff73", "#04140a"], tags: ["retro", "tech", "green", "terminal"] },
];

export const KIND_LABEL: Record<Wallpaper["kind"], string> = {
  shader: "Live shader",
  photo: "Photo",
  video: "Video",
  web: "Web page",
};
