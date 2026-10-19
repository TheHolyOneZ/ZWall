import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type MenuItem, useStore } from "../../lib/store";

const WIDTH = 220;

export function MenuList({ items, x, y, onClose, depth = 0, minWidth = WIDTH }: { items: MenuItem[]; x: number; y: number; onClose(): void; depth?: number; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, maxH: 0 });
  const [active, setActive] = useState(-1);
  const [openSub, setOpenSub] = useState<number | null>(null);
  const actionable = items.map((it, i) => (!it.separator && !it.heading && !it.disabled ? i : -1)).filter((i) => i >= 0);

  const checkable = items.some((it) => it.checked !== undefined);

  const place = () => {
    const el = ref.current;
    if (!el) return;
    const M = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const nx = x + w > vw - M ? Math.max(M, depth > 0 ? x - w - minWidth + 8 : vw - w - M) : x;
    const maxH = Math.min(h, vh - 2 * M);
    const ny = Math.min(Math.max(M, y), vh - M - maxH);
    setPos({ x: nx, y: ny, maxH });
  };
  useLayoutEffect(place, [x, y, depth, minWidth, items.length]);
  useEffect(() => {
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });

  useEffect(() => {
    if (depth > 0) return;
    ref.current?.focus();
  }, [depth]);

  const pick = (i: number) => {
    const it = items[i];
    if (!it || it.disabled || it.separator || it.heading) return;
    if (it.submenu) return setOpenSub(i);
    onClose();
    it.onSelect?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (openSub !== null) return;
    const at = actionable.indexOf(active);
    const go = (i: number) => {
      setActive(i);
      rowRefs.current[i]?.scrollIntoView({ block: "nearest" });
    };
    if (e.key === "ArrowDown") (e.preventDefault(), go(actionable[(at + 1) % actionable.length] ?? -1));
    else if (e.key === "ArrowUp") (e.preventDefault(), go(actionable[(at - 1 + actionable.length) % actionable.length] ?? -1));
    else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), pick(active));
    else if (e.key === "ArrowRight" && items[active]?.submenu) (e.preventDefault(), setOpenSub(active));
    else if (e.key === "Escape" || (e.key === "ArrowLeft" && depth > 0)) (e.preventDefault(), e.stopPropagation(), onClose());
  };

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sub = openSub !== null ? items[openSub] : null;
  const subRect = openSub !== null ? rowRefs.current[openSub]?.getBoundingClientRect() : null;

  return (
    <>
      <motion.div
        ref={ref}
        role="menu"
        tabIndex={-1}
        className="glass-3 fixed rounded-[10px] py-1 outline-none"
        style={{ left: pos.x, top: pos.y, minWidth, zIndex: 100 + depth, maxHeight: pos.maxH || undefined, overflowY: "auto", overscrollBehavior: "contain" }}
        onScroll={() => openSub !== null && setOpenSub(null)}
        initial={{ opacity: 0, scale: 0.97, y: -3 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
        transition={{ duration: 0.12 }}
        onKeyDown={onKey}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className="my-1 h-px mx-2" style={{ background: "var(--edge)" }} />
          ) : it.heading ? (
            <div key={i} className={`${checkable ? "pl-[34px]" : "pl-3"} pr-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-[0.06em]`} style={{ color: "var(--text-3)" }}>
              {it.label}
            </div>
          ) : (
            <div
              key={i}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              role="menuitem"
              aria-disabled={it.disabled}
              className="mx-1 flex items-center gap-2 h-[28px] pl-2 pr-2 rounded-[6px] text-[13px] cursor-default"
              style={{
                color: it.disabled ? "var(--text-4)" : it.danger ? "var(--err)" : "var(--text)",
                background: active === i || openSub === i ? "var(--e3)" : undefined,
              }}
              onPointerEnter={() => {
                setActive(i);
                setOpenSub(it.submenu && !it.disabled ? i : null);
              }}
              onClick={() => pick(i)}
            >
              {checkable && <span className="w-[14px] shrink-0 grid place-items-center">{it.checked && <Check size={13} />}</span>}
              <span className="flex-1 truncate">{it.label}</span>
              {it.hint && <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{it.hint}</span>}
              {it.submenu && <ChevronRight size={13} style={{ color: "var(--text-3)" }} />}
            </div>
          ),
        )}
      </motion.div>
      <AnimatePresence>
        {sub?.submenu && subRect && (
          <MenuList key={openSub} items={sub.submenu} x={subRect.right + 2} y={subRect.top - 4} depth={depth + 1} minWidth={180} onClose={() => (depth === 0 ? onClose() : onClose())} />
        )}
      </AnimatePresence>
    </>
  );
}

export function ContextMenuHost() {
  const menu = useStore((s) => s.menu);
  const close = useStore((s) => s.closeMenu);
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => !(e.target as HTMLElement).closest("[role=menu]") && close();
    const away = () => close();

    const wheel = (e: WheelEvent) => !(e.target as HTMLElement).closest("[role=menu]") && close();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("blur", away);
    window.addEventListener("resize", away);
    window.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("blur", away);
      window.removeEventListener("resize", away);
      window.removeEventListener("wheel", wheel);
    };
  }, [menu, close]);
  return <AnimatePresence>{menu && <MenuList key={`${menu.x},${menu.y}`} items={menu.items} x={menu.x} y={menu.y} onClose={close} />}</AnimatePresence>;
}

export function contextMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  useStore.getState().openMenu(e.clientX, e.clientY, items);
}
