const targets = new Map<string, HTMLElement>();

export function registerTarget(id: string, el: HTMLElement | null) {
  if (el) targets.set(id, el);
  else targets.delete(id);
}

export function hitTest(x: number, y: number): string | null {
  let hit: string | null = null;
  for (const [id, el] of targets) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      if (id.startsWith("span:")) return id;
      hit = id;
    }
  }
  return hit;
}
