

import { send } from "./actions";
import { useStore } from "./store";
import type { Wallpaper } from "./types";

export function tryOn(w: Wallpaper, monitor: string) {
  const s = useStore.getState();
  const prev = s.trial?.monitor === monitor ? s.trial.prev : (s.engine?.monitors.find((m) => m.name === monitor)?.wallpaper ?? null);
  send({ SetWallpaper: { path: w.path, monitors: [monitor] } });
  useStore.setState({ trial: { monitor, name: w.name, prev } });
}

export function keepTrial() {
  useStore.setState({ trial: null });
}

export function endTrial() {
  const t = useStore.getState().trial;
  if (!t) return;
  send(t.prev ? { SetWallpaper: { path: t.prev, monitors: [t.monitor] } } : { Clear: { monitor: t.monitor } });
  useStore.setState({ trial: null });
}
