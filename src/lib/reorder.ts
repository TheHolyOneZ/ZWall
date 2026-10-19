import { useRef, useState } from "react";

interface Drag {
  key: string;
  from: number;
  to: number;
  dx: number;
  dy: number;

  x: number;
  y: number;

  shift: number;
  out: boolean;
}

export interface ReorderOptions {
  onOrder(keys: string[]): void;

  canOut?(key: string): boolean;
  onOut?(key: string): void;

  bounds?(): DOMRect | null;
}

export function useReorder(keys: string[], opts: ReorderOptions) {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const justDragged = useRef(false);

  const begin = (key: string, e: React.PointerEvent) => {
    if (e.button !== 0 || !listRef.current) return;
    const items = [...listRef.current.querySelectorAll<HTMLElement>(":scope > [data-rkey]")];
    const rects = items.map((el) => el.getBoundingClientRect());
    const from = items.findIndex((el) => el.dataset.rkey === key);
    if (from < 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    const shift = rects[from].height + gap;
    const outable = !!opts.onOut && (opts.canOut?.(key) ?? true);
    let state: Drag | null = null;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!state && Math.hypot(dx, dy) < 6) return;
      const b = opts.bounds?.();
      const out = outable && !!b && (ev.clientX < b.left - 24 || ev.clientX > b.right + 24);

      const to = rects.filter((r, i) => i !== from && r.top + r.height / 2 < ev.clientY).length;
      state = { key, from, to, dx, dy, x: ev.clientX, y: ev.clientY, shift, out };
      setDrag(state);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!state) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      if (state.out) opts.onOut?.(state.key);
      else if (state.to !== state.from) {
        const next = keys.filter((k) => k !== state!.key);
        next.splice(state.to, 0, state.key);
        opts.onOrder(next);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const item = (key: string) => {
    const i = keys.indexOf(key);
    let transform: string | undefined;
    let dragged = false;
    if (drag) {
      if (key === drag.key) {
        dragged = true;
        transform = `translate(${drag.out ? drag.dx : 0}px, ${drag.dy}px)`;
      } else if (!drag.out && drag.from < drag.to && i > drag.from && i <= drag.to) transform = `translateY(${-drag.shift}px)`;
      else if (!drag.out && drag.to < drag.from && i >= drag.to && i < drag.from) transform = `translateY(${drag.shift}px)`;
    }
    return {
      "data-rkey": key,
      "data-dragging": dragged || undefined,
      style: {
        position: "relative" as const,
        transform,
        transition: dragged ? "opacity .12s" : drag ? "transform .16s cubic-bezier(.2,.8,.2,1)" : undefined,
        zIndex: dragged ? 5 : undefined,
        opacity: dragged && drag?.out ? 0.45 : undefined,

        ...(dragged ? { background: "var(--panel-2)", borderRadius: 10, boxShadow: "0 10px 28px rgba(0,0,0,.4), inset 0 0 0 1px var(--edge)" } : {}),
      },
    };
  };

  const grip = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => begin(key, e),
    onClickCapture: (e: React.MouseEvent) => {
      if (justDragged.current) (e.stopPropagation(), e.preventDefault());
    },
  });

  return { listRef, item, grip, drag };
}
