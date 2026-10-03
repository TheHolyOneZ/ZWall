

export function setGlass(on: boolean) {
  document.documentElement.dataset.glass = on ? "on" : "off";
  try {
    localStorage.setItem("zwall.glass", on ? "on" : "off");
  } catch {

  }
}
try {
  document.documentElement.dataset.glass = localStorage.getItem("zwall.glass") ?? "on";
} catch {
  document.documentElement.dataset.glass = "on";
}


import("./ipc").then(({ bridge }) => bridge.then((b) => b.windowGlass()).then((on) => (document.documentElement.dataset.windowGlass = on ? "on" : "off"), () => {}));
