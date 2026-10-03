

use crate::backend::{Backend, Rect};
use std::{collections::BTreeMap, time::{Duration, Instant}};
use zwall_ipc::{Settings, State};


const COVERED: f32 = 0.95;

pub struct Conditions {
    last: Option<Instant>,
    pub on_battery: bool,
}

impl Conditions {
    pub fn new() -> Self {
        Self { last: None, on_battery: false }
    }


    pub fn resting(&mut self, backend: &dyn Backend, s: &State) -> Option<BTreeMap<String, String>> {
        if self.last.is_some_and(|t| t.elapsed() < Duration::from_secs(1)) {
            return None;
        }
        self.last = Some(Instant::now());
        self.on_battery = crate::desktop::on_battery();
        let mut out = BTreeMap::new();
        if s.settings.when_covered == "keep" {
            return Some(out);
        }
        for m in s.monitors.iter().filter(|m| m.wallpaper.is_some()) {
            let r = Rect { x: m.x, y: m.y, w: m.width, h: m.height };
            if backend.covered(r).is_some_and(|c| c >= COVERED) {
                out.insert(m.name.clone(), s.settings.when_covered.clone());
            }
        }
        Some(out)
    }
}


pub fn rest_of<'a>(key: &str, resting: &'a BTreeMap<String, String>) -> Option<&'a str> {
    let names: Vec<&str> = match key.strip_prefix("span:") {
        Some(g) => g.split('+').collect(),
        None => vec![key],
    };
    let first = resting.get(names[0])?;
    names.iter().all(|n| resting.get(*n) == Some(first)).then_some(first.as_str())
}


pub fn effective(settings: &Settings, on_battery: bool) -> (u32, f32) {
    if on_battery && settings.battery_saver && !settings.pause_battery {
        (settings.fps_cap.min(30), settings.quality.min(0.5))
    } else {
        (settings.fps_cap, settings.quality)
    }
}


pub fn daylight(hour: f32) -> [f32; 3] {
    const NIGHT: [f32; 3] = [0.62, 0.7, 0.9];
    const GOLDEN: [f32; 3] = [1.06, 0.93, 0.8];
    const DAY: [f32; 3] = [1.0, 1.0, 1.0];
    let keys: [(f32, [f32; 3]); 8] = [(0.0, NIGHT), (5.0, NIGHT), (7.0, GOLDEN), (9.0, DAY), (16.5, DAY), (19.0, GOLDEN), (21.5, NIGHT), (24.0, NIGHT)];
    let h = hour.rem_euclid(24.0);
    for w in keys.windows(2) {
        let ((h0, a), (h1, b)) = (w[0], w[1]);
        if h >= h0 && h <= h1 {
            let t = if h1 > h0 { (h - h0) / (h1 - h0) } else { 0.0 };
            let t = t * t * (3.0 - 2.0 * t);
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        }
    }
    DAY
}

pub fn local_hour() -> f32 {
    use chrono::Timelike;
    let now = chrono::Local::now();
    now.hour() as f32 + now.minute() as f32 / 60.0
}


pub fn grade(settings: &Settings, calm: bool) -> [f32; 3] {
    let mut g = if settings.follow_daylight { daylight(local_hour()) } else { [1.0; 3] };
    if calm {
        g = g.map(|c| c * 0.8);
    }
    g
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daylight_curve() {
        assert_eq!(daylight(12.0), [1.0, 1.0, 1.0]);
        assert_eq!(daylight(2.0), [0.62, 0.7, 0.9]);
        let dusk = daylight(19.0);
        assert!(dusk[0] > dusk[2], "dusk is warm");
        let late = daylight(20.5);
        assert!(late[0] < 1.0 && late[0] > 0.62, "evening fades toward night");
    }

    #[test]
    fn battery_saver() {
        let s = Settings { pause_battery: false, fps_cap: 60, quality: 1.0, ..Default::default() };
        assert_eq!(effective(&s, true), (30, 0.5));
        assert_eq!(effective(&s, false), (60, 1.0));
        assert_eq!(effective(&Settings { battery_saver: false, ..s.clone() }, true), (60, 1.0));
    }
}
