import { Blend } from "lucide-react";
import { useRef, useState } from "react";
import { send } from "../lib/actions";
import { blendKey } from "../lib/desk";
import { assetUrl } from "../lib/ipc";
import type { BlendEdge, BlendLink, Monitor } from "../lib/types";

interface Placed {
  m: Monitor;
  left: number;
  top: number;
  w: number;
  h: number;
}

type Handle = "reachA" | "reachB" | "a0" | "a1" | "b0" | "b1";

export function Seams({ placed, pairs, links, blends, zoom = 1 }: { placed: Placed[]; pairs: BlendLink[]; links: Record<string, BlendLink>; blends: Record<string, BlendEdge[]>; zoom?: number }) {
  const z = 1 / zoom;
  const svg = useRef<SVGSVGElement>(null);
  const [edit, setEdit] = useState<BlendLink | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const save = (l: BlendLink) => send({ SetBlendLinks: { ...links, [blendKey(l.a, l.b)]: l } });

  return (
    <>
      <svg ref={svg} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 3, overflow: "visible" }}>
        <defs>
          {["h", "v"].map((o) =>
            [0, 1].map((dir) => (
              <linearGradient key={`${o}${dir}`} id={`seam-fade-${o}${dir}`} x1="0" y1="0" x2={o === "h" ? 1 : 0} y2={o === "h" ? 0 : 1}>
                <stop offset="0" stopColor="#fff" stopOpacity={dir ? 0.22 : 0} />
                <stop offset="1" stopColor="#fff" stopOpacity={dir ? 0 : 0.22} />
              </linearGradient>
            )),
          )}
        </defs>
        {pairs.map((base) => {
          const key = blendKey(base.a, base.b);
          const l = edit && blendKey(edit.a, edit.b) === key ? edit : base;
          const g = geometry(l, placed);
          if (!g || !l.enabled) return null;
          const hover = hot === key || edit !== null;
          const drag = (h: Handle) => (e: React.PointerEvent) => {
            e.stopPropagation();
            e.preventDefault();
            const box = svg.current!.getBoundingClientRect();

            const k = svg.current!.clientWidth / box.width || 1;
            let cur = l;
            const move = (ev: PointerEvent) => {
              const [x, y] = [(ev.clientX - box.left) * k, (ev.clientY - box.top) * k];
              const along = g.H ? y : x;
              const across = g.H ? x : y;
              const f = (v: number) => Math.max(0, Math.min(1, v));
              const n = { ...cur };
              if (h === "reachA") n.into_a = Math.max(0.02, Math.min(0.5, (g.A.edge - across) / g.A.acr));
              if (h === "reachB") n.into_b = Math.max(0.02, Math.min(0.5, (across - g.B.edge) / g.B.acr));
              if (h === "a0") n.a_span = [Math.min(f((along - g.A.start) / g.A.len), n.a_span[1] - 0.05), n.a_span[1]];
              if (h === "a1") n.a_span = [n.a_span[0], Math.max(f((along - g.A.start) / g.A.len), n.a_span[0] + 0.05)];
              if (h === "b0") n.b_span = [Math.min(f((along - g.B.start) / g.B.len), n.b_span[1] - 0.05), n.b_span[1]];
              if (h === "b1") n.b_span = [n.b_span[0], Math.max(f((along - g.B.start) / g.B.len), n.b_span[0] + 0.05)];
              cur = n;
              setEdit(n);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              save(cur);
              setTimeout(() => setEdit(null), 400);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          };
          const P = (along: number, across: number) => (g.H ? [across, along] : [along, across]);
          const box = (a0: number, a1: number, c0: number, c1: number) => {
            const [x0, y0] = P(Math.min(a0, a1), Math.min(c0, c1));
            const [x1, y1] = P(Math.max(a0, a1), Math.max(c0, c1));
            return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          };
          const imgA = blends[l.a]?.find((e) => e.side === (g.H ? "right" : "bottom"));
          const imgB = blends[l.b]?.find((e) => e.side === (g.H ? "left" : "top"));
          const reachA = g.A.edge - l.into_a * g.A.acr;
          const reachB = g.B.edge + l.into_b * g.B.acr;
          const [aS0, aS1] = [g.A.start + l.a_span[0] * g.A.len, g.A.start + l.a_span[1] * g.A.len];
          const [bS0, bS1] = [g.B.start + l.b_span[0] * g.B.len, g.B.start + l.b_span[1] * g.B.len];
          const quad = [P(aS0, g.A.edge), P(bS0, g.B.edge), P(bS1, g.B.edge), P(aS1, g.A.edge)].map((p) => p.join(",")).join(" ");
          const o = g.H ? "h" : "v";
          const dot = (h: Handle, along: number, across: number) => {
            const [cx, cy] = P(along, across);
            return (
              <g key={h} className="pointer-events-auto" style={{ cursor: g.H ? "ns-resize" : "ew-resize" }} onPointerDown={drag(h)}>
                <circle cx={cx} cy={cy} r={12 * z} fill="transparent" />
                <circle cx={cx} cy={cy} r={(hover ? 5 : 3.5) * z} fill="#f3efe6" stroke="rgba(0,0,0,.45)" strokeWidth={1.5 * z} style={{ transition: "r .15s" }} />
              </g>
            );
          };
          const reach = (h: Handle, across: number, s0: number, s1: number) => {
            const [x0, y0] = P(s0, across);
            const [x1, y1] = P(s1, across);
            const [mx, my] = P((s0 + s1) / 2, across);
            return (
              <g key={h} className="pointer-events-auto" style={{ cursor: g.H ? "ew-resize" : "ns-resize" }} onPointerDown={drag(h)}>
                <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="transparent" strokeWidth={14 * z} />
                <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgba(243,239,230,.55)" strokeWidth={1.5 * z} strokeDasharray={`${4 * z} ${4 * z}`} opacity={hover ? 1 : 0.5} />
                <rect x={mx - (g.H ? 3 : 12) * z} y={my - (g.H ? 12 : 3) * z} width={(g.H ? 6 : 24) * z} height={(g.H ? 24 : 6) * z} rx={3 * z} fill="#f3efe6" opacity={hover ? 1 : 0.6} />
              </g>
            );
          };
          return (
            <g key={key} onPointerEnter={() => setHot(key)} onPointerLeave={() => setHot(null)}>

              {imgA && assetUrl(imgA.image) ? (
                <image href={assetUrl(imgA.image)!} preserveAspectRatio="none" {...box(g.A.start, g.A.start + g.A.len, reachA, g.A.edge)} />
              ) : (
                <rect {...box(aS0, aS1, reachA, g.A.edge)} fill={`url(#seam-fade-${o}0)`} />
              )}
              {imgB && assetUrl(imgB.image) ? (
                <image href={assetUrl(imgB.image)!} preserveAspectRatio="none" {...box(g.B.start, g.B.start + g.B.len, g.B.edge, reachB)} />
              ) : (
                <rect {...box(bS0, bS1, g.B.edge, reachB)} fill={`url(#seam-fade-${o}1)`} />
              )}

              <polygon points={quad} fill="rgba(243,239,230,.08)" stroke="rgba(243,239,230,.35)" strokeWidth={z} strokeDasharray={`${3 * z} ${3 * z}`} />
              <g className="pointer-events-auto" style={{ pointerEvents: "visibleFill" }}>
                <polygon points={quad} fill="transparent" />
              </g>
              {reach("reachA", reachA, aS0, aS1)}
              {reach("reachB", reachB, bS0, bS1)}
              {dot("a0", aS0, g.A.edge)}
              {dot("a1", aS1, g.A.edge)}
              {dot("b0", bS0, g.B.edge)}
              {dot("b1", bS1, g.B.edge)}
            </g>
          );
        })}
      </svg>

      {pairs.map((base) => {
        const key = blendKey(base.a, base.b);
        const l = edit && blendKey(edit.a, edit.b) === key ? edit : base;
        const g = geometry(l, placed);
        if (!g) return null;
        const lo = Math.max(g.A.start + l.a_span[0] * g.A.len, g.B.start + l.b_span[0] * g.B.len);
        const hi = Math.min(g.A.start + l.a_span[1] * g.A.len, g.B.start + l.b_span[1] * g.B.len);
        const mid = hi > lo ? (lo + hi) / 2 : (g.A.start + g.A.len / 2 + g.B.start + g.B.len / 2) / 2;
        const across = (g.A.edge + g.B.edge) / 2;
        const [x, y] = g.H ? [across, mid] : [mid, across];
        return (
          <button
            key={key}
            className="absolute inline-flex items-center gap-1 h-[24px] px-2 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors"
            style={{
              left: x,
              top: y,
              transform: `translate(-50%, -50%) scale(${z})`,
              zIndex: 6,
              background: l.enabled ? "rgba(243,239,230,.92)" : "rgba(20,20,26,.78)",
              color: l.enabled ? "#141418" : "var(--text-3)",
              boxShadow: l.enabled ? "0 4px 14px rgba(0,0,0,.4)" : "inset 0 0 0 1px var(--edge)",
              writingMode: "horizontal-tb",
            }}
            title={l.enabled ? `Blending ${l.a} and ${l.b} at ${Math.round(l.strength * 100)}%. Scroll to change strength, double-click to reset, click to turn off.` : `Blend ${l.a} into ${l.b}`}
            onClick={() => save({ ...l, enabled: !l.enabled })}
            onDoubleClick={() => {
              const rest = { ...links };
              delete rest[key];
              send({ SetBlendLinks: rest });
            }}
            onWheel={(e) => {
              e.stopPropagation();
              if (!l.enabled) return;
              const strength = Math.max(0.05, Math.min(1, Math.round((l.strength + (e.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
              setEdit({ ...l, strength });
              save({ ...l, strength });
              setTimeout(() => setEdit(null), 400);
            }}
          >
            <Blend size={12} />
            {l.enabled ? `${Math.round(l.strength * 100)}%` : "Blend"}
          </button>
        );
      })}
    </>
  );
}

interface Side {
  edge: number;
  start: number;
  len: number;
  acr: number;
}

function geometry(l: BlendLink, placed: Placed[]): { H: boolean; A: Side; B: Side } | null {
  const a = placed.find((p) => p.m.name === l.a);
  const b = placed.find((p) => p.m.name === l.b);
  if (!a || !b) return null;
  const H = !l.stacked;
  return {
    H,
    A: H ? { edge: a.left + a.w, start: a.top, len: a.h, acr: a.w } : { edge: a.top + a.h, start: a.left, len: a.w, acr: a.h },
    B: H ? { edge: b.left, start: b.top, len: b.h, acr: b.w } : { edge: b.top, start: b.left, len: b.w, acr: b.h },
  };
}
