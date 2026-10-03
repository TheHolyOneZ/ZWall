

import type { BlendLink, EngineState, Monitor } from "./types";

export function onDesk(m: Monitor, arrangement: Record<string, [number, number]> | undefined): Monitor {
  const p = arrangement?.[m.name];
  return p ? { ...m, x: p[0], y: p[1] } : m;
}

export const tolerance = (len: number) => Math.max(64, len * 0.05);

export function blendKey(a: string, b: string) {
  return `${a}|${b}`;
}


export function pairs(st: EngineState): BlendLink[] {
  const ms = st.monitors.map((m) => onDesk(m, st.arrangement));
  const out: BlendLink[] = [];
  for (const a of ms)
    for (const b of ms) {
      if (a.name === b.name || (a.span && a.span === b.span)) continue;
      const side = Math.abs(a.x + a.width - b.x) <= tolerance(Math.min(a.width, b.width));
      const v0 = Math.max(a.y, b.y), v1 = Math.min(a.y + a.height, b.y + b.height);
      const stack = Math.abs(a.y + a.height - b.y) <= tolerance(Math.min(a.height, b.height));
      const h0 = Math.max(a.x, b.x), h1 = Math.min(a.x + a.width, b.x + b.width);
      let stacked: boolean, lo: number, hi: number;
      if (side && v1 > v0 && a.x < b.x) [stacked, lo, hi] = [false, v0, v1];
      else if (stack && h1 > h0 && a.y < b.y && !side) [stacked, lo, hi] = [true, h0, h1];
      else continue;
      const saved = st.blend_links?.[blendKey(a.name, b.name)];
      if (saved) {
        out.push({ ...saved, stacked });
        continue;
      }
      const [pa, la, pb, lb] = stacked ? [a.x, a.width, b.x, b.width] : [a.y, a.height, b.y, b.height];
      const f = (v: number) => Math.max(0, Math.min(1, v));
      out.push({
        a: a.name,
        b: b.name,
        stacked,
        enabled: st.settings.blend_edges,
        into_a: st.settings.blend_width,
        into_b: st.settings.blend_width,
        a_span: [f((lo - pa) / la), f((hi - pa) / la)],
        b_span: [f((lo - pb) / lb), f((hi - pb) / lb)],
        strength: st.settings.blend_strength,
      });
    }
  return out;
}
