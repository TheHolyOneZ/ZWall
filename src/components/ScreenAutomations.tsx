

import { forScreen, title } from "../lib/automations";
import { useStore } from "../lib/store";
import { Tip } from "./Tip";

export function ScreenAutomations({ monitor }: { monitor: string }) {

  useStore((s) => s.engine?.automations);
  const mine = forScreen(monitor);
  const open = () => (mine.length ? useStore.getState().setFocusAutomation(mine[0].id) : useStore.getState().setMode("automate"));
  const label = mine.length === 0 ? "Automate" : mine.length === 1 ? "Automated" : `${mine.length} automations`;
  return (
    <Tip label={mine.length ? mine.map(title).join(" · ") : `Change ${monitor} on a schedule, at random, when apps open…`}>
      <button className="text-[11px] underline-offset-2 hover:underline" style={{ color: mine.length ? "var(--text-2)" : "var(--text-3)" }} onClick={open}>
        {label}
      </button>
    </Tip>
  );
}
