

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const KEY = "zwall.intro";

let played = false;

export function introEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setIntroEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {

  }
}


const TOP_BAR = "210,195 815,195 815,320 210,320";
const BOTTOM_BAR = "210,705 815,705 815,830 210,830";
const BAND = "590,195 815,195 435,830 210,830";
const WINDOW = "599,211 787,211 426,814 238,814";

const C = 0.5005;

const STARS: [number, number, number][] = [
  [640, 262, 3.2], [700, 300, 2.2], [760, 245, 2.6], [585, 330, 2], [668, 372, 3.4], [520, 410, 2.2],
  [744, 330, 1.8], [610, 455, 2], [470, 470, 1.6], [560, 280, 1.6], [705, 425, 1.8], [500, 360, 1.4],
];


function Scene({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="200" x2="0" y2="640" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0d1940" />
          <stop offset="0.55" stopColor="#24408a" />
          <stop offset="1" stopColor="#4a63b8" />
        </linearGradient>
        <linearGradient id={`${id}-trail`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#efe9dc" stopOpacity="0" />
          <stop offset="1" stopColor="#efe9dc" />
        </linearGradient>
      </defs>
      <rect className="intro-sky" x="-1600" y="-1600" width="4224" height="4224" fill={`url(#${id}-sky)`} />
      {STARS.map(([x, y, r], i) => (
        <circle key={i} className="intro-star" cx={x} cy={y} r={r} fill="#f4efe4" style={{ animationDelay: `${0.55 + i * 0.06}s, ${1.4 + (i % 4) * 0.35}s` }} />
      ))}
      <g className="intro-shoot">
        <line x1="0" y1="0" x2="120" y2="0" stroke={`url(#${id}-trail)`} strokeWidth="3" strokeLinecap="round" />
      </g>
      <path className="intro-hill h1" d="M-1600 548 Q280 470 420 520 T640 488 T900 528 T2624 520 V2624 H-1600Z" fill="#a395e6" />
      <path className="intro-hill h2" d="M-1600 604 Q330 548 470 592 T760 572 T2624 600 V2624 H-1600Z" fill="#7667c6" />
      <path className="intro-hill h3" d="M-1600 676 Q360 622 520 664 T2624 650 V2624 H-1600Z" fill="#4c437f" />
      <path className="intro-hill h4" d="M-1600 760 Q420 714 2624 744 V2624 H-1600Z" fill="#2b2843" />
    </>
  );
}


export function introWanted(): boolean {
  return !played && introEnabled();
}

export function Intro({ onLeave }: { onLeave(): void }) {
  const [on, setOn] = useState(introWanted);
  const [leaving, setLeavingState] = useState(false);
  const setLeaving = (v: boolean) => {
    setLeavingState(v);
    if (v) onLeave();
  };

  useEffect(() => {
    if (!on) return;
    played = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const t1 = setTimeout(() => setLeaving(true), reduced ? 700 : 2400);
    const t2 = setTimeout(() => setOn(false), reduced ? 1000 : 3100);
    const skip = () => {
      clearTimeout(t1);
      clearTimeout(t2);
      setLeaving(true);
      setTimeout(() => setOn(false), 280);
    };
    window.addEventListener("keydown", skip, { once: true });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("keydown", skip);
    };
  }, [on]);


  const box = useRef<HTMLDivElement>(null);
  const full = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r || !full.current) return;
      const [ox, oy] = [r.left + C * r.width, r.top + C * r.height];
      const [w, h] = [r.width * 5, r.height * 5];
      Object.assign(full.current.style, { left: `${ox - C * w}px`, top: `${oy - C * h}px`, width: `${w}px`, height: `${h}px` });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [on]);

  if (!on) return null;
  return (
    <div
      className={`intro${leaving ? " is-leaving" : ""}`}
      aria-hidden

      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName === "intro-out") {
          setLeaving(true);
          setOn(false);
        }
      }}
      onPointerDown={() => {
        setLeaving(true);
        setTimeout(() => setOn(false), 280);
      }}
    >

      <svg ref={full} className="intro-full" viewBox="0 0 1024 1024">
        <Scene id="full" />
      </svg>
      <div className="intro-stage">
        <div ref={box} className="intro-zoom">

          <svg className="intro-logo" viewBox="0 0 1024 1024">
            <defs>
              <clipPath id="intro-window">
                <polygon points={WINDOW} />
              </clipPath>
            </defs>

            <g fill="#efe9dc" stroke="#efe9dc" strokeWidth="24" strokeLinejoin="round">
              <polygon className="intro-bar top" points={TOP_BAR} />
              <polygon className="intro-bar bottom" points={BOTTOM_BAR} />
              <polygon className="intro-frame" points={BAND} />
            </g>
            <g clipPath="url(#intro-window)" className="intro-window">
              <Scene id="win" />
            </g>
          </svg>
        </div>
        <div className="intro-word">
          <span className="intro-name">ZWall</span>
          <span className="intro-tag">Live wallpapers</span>
          <span className="intro-by">
            by <b>TheHolyOneZ</b>
          </span>
        </div>
      </div>
    </div>
  );
}
