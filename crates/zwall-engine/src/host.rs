

use crate::{
    backend::Backend,
    feed::Feed,
    pause::{self, Signals},
    plasma,
    server::Hub,
};
use serde_json::{json, Map, Value};
use std::{
    collections::BTreeSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use zwall_ipc::{Motion, PauseReason, State};

fn kind(path: &str) -> &'static str {
    if path.starts_with("preset://") {
        "shader"
    } else if zwall_render::is_web(path) {
        "web"
    } else if zwall_render::is_video(path) {
        "video"
    } else {
        "photo"
    }
}

fn file_url(path: &str) -> String {
    let mut url = String::from("file://");
    for c in path.chars() {
        match c {
            ' ' => url.push_str("%20"),
            '#' => url.push_str("%23"),
            '%' => url.push_str("%25"),
            '?' => url.push_str("%3F"),
            c => url.push(c),
        }
    }
    url
}


fn to_desk(s: &State, x: i32, y: i32) -> (i32, i32) {
    match s.monitors.iter().find(|m| x >= m.x && y >= m.y && x < m.x + m.width as i32 && y < m.y + m.height as i32) {
        Some(m) => {
            let (dx, dy) = s.desk(m);
            (x - m.x + dx, y - m.y + dy)
        }
        None => (x, y),
    }
}


pub fn state_json(s: &State, on_battery: bool) -> String {
    let (fps, quality) = crate::conditions::effective(&s.settings, on_battery);
    let accent = s.accent.as_deref().and_then(crate::desktop::parse_hex).unwrap_or([0.70, 0.36, 1.0]);

    let mut heard = BTreeSet::new();
    let mut names: Vec<&zwall_ipc::Monitor> = s.monitors.iter().collect();
    names.sort_by(|a, b| a.name.cmp(&b.name));
    let mut monitors = Map::new();
    for m in names {
        let Some(path) = &m.wallpaper else { continue };
        let group: Vec<&zwall_ipc::Monitor> = match &m.span {
            Some(g) => s.monitors.iter().filter(|o| o.span.as_ref() == Some(g)).collect(),
            None => vec![m],
        };

        let x0 = group.iter().map(|o| s.desk(o).0).min().unwrap();
        let y0 = group.iter().map(|o| s.desk(o).1).min().unwrap();
        let x1 = group.iter().map(|o| s.desk(o).0 + o.width as i32).max().unwrap();
        let y1 = group.iter().map(|o| s.desk(o).1 + o.height as i32).max().unwrap();
        let (mx, my) = s.desk(m);
        let params = s.params_for(path, &m.name);
        let k = kind(path);
        let rest = crate::conditions::rest_of(&m.name, &s.resting).unwrap_or("");
        let audible = (k == "video" || k == "web") && rest != "paused" && heard.insert(path.clone());
        let g = crate::conditions::grade(&s.settings, rest == "calm");
        let round = |v: f32| (v * 1000.0).round() / 1000.0;
        monitors.insert(
            m.name.clone(),
            json!({
                "path": path,
                "kind": k,
                "shader": path.strip_prefix("preset://").unwrap_or(""),
                "url": match k {
                    "shader" => String::new(),
                    "web" => file_url(&zwall_render::web_entry(path)),
                    _ => file_url(path),
                },
                "depthUrl": s.depths.get(path).map(|d| file_url(d)).unwrap_or_default(),
                "overlay": params.overlay.name().unwrap_or(""),
                "overlayAmount": params.overlay_amount,
                "rect": [mx, my, m.width, m.height],
                "widgets": s.widgets.iter().filter(|w| w.monitor == m.name).map(|w| {
                    let mut v = serde_json::to_value(w).unwrap_or_default();

                    if w.color == "accent" {
                        v["color"] = json!(format!("#{:02x}{:02x}{:02x}", (accent[0] * 255.0) as u8, (accent[1] * 255.0) as u8, (accent[2] * 255.0) as u8));
                    }
                    v
                }).collect::<Vec<_>>(),
                "blend": s.blends.get(&m.name).map(|b| b.iter().map(|e| json!({ "side": e.side, "url": file_url(&e.image), "size": e.size })).collect::<Vec<_>>()).unwrap_or_default(),
                "canvas": [x0, y0, x1 - x0, y1 - y0],
                "speed": if rest == "calm" { params.speed * 0.3 } else { params.speed },
                "rest": rest,
                "grade": [round(g[0]), round(g[1]), round(g[2])],
                "life": params.life,
                "motionUrl": s.scenes.get(path).map(|x| file_url(&x.map)).unwrap_or_default(),
                "intensity": params.intensity,
                "depth": params.depth,
                "motion": params.motion,
                "tint": params.tint,
                "volume": if audible && !crate::desktop::muted(&s.settings) { s.settings.volume as f32 / 100.0 * params.volume } else { 0.0 },
            }),
        );
    }
    json!({
        "t": "state",
        "paused": s.paused != PauseReason::None,
        "fps": fps,
        "webFps": if s.settings.web_fps == 0 { fps } else { s.settings.web_fps.min(fps) },
        "quality": quality,
        "accent": accent,
        "monitors": Value::Object(monitors),
    })
    .to_string()
}

pub fn run(hub: Arc<Hub>, mut backend: Box<dyn Backend>, stop: Arc<AtomicBool>, feed: Arc<Feed>) {

    let mut gpu = zwall_render::Gpu::new();
    hub.set_thumbnails(crate::render::render_thumbnails(&mut gpu));
    if let Some(name) = gpu.adapter_name() {
        hub.set_gpu(name);
    }
    drop(gpu);


    let mut taken: BTreeSet<String> = hub.plasma_originals().into_keys().collect();
    let mut last_signals = Instant::now() - Duration::from_secs(1);
    let mut last_pointer = (i32::MIN, i32::MIN);
    let mut stats = crate::widgets::Stats::new();
    let mut hotkeys_on: Option<bool> = None;
    let mut accent = crate::accent::AccentSync::new();
    let mut cond = crate::conditions::Conditions::new();
    let mut saver = crate::saver::Saver::new();
    let mut last_saver = Instant::now();
    let mut meter = crate::gpu::Meter::new();
    let mut last_gpu = Instant::now();

    while !stop.load(Ordering::Relaxed) && !hub.quitting() {
        crate::automation::tick(&hub);
        crate::blend::tick(&hub);
        crate::depth::scan(&hub);
        let s = hub.snapshot();

        if s.widgets.iter().any(|w| w.kind == "system" || w.kind == "battery") {
            if let Some(v) = stats.sample() {
                feed.send(v.to_string());
            }
        }
        let input = backend.pump();
        if hotkeys_on != Some(s.settings.hotkeys) {
            hotkeys_on = Some(s.settings.hotkeys);
            hub.set_shortcuts(backend.set_hotkeys(s.settings.hotkeys));
        }
        for h in &input.hotkeys {
            hub.hotkey(*h);
        }
        let clicks = input.clicks;
        if saver.active() || last_saver.elapsed() >= Duration::from_millis(500) {
            last_saver = Instant::now();
            let idle = backend.idle_ms();
            let fullscreen = backend.fullscreen_active();
            saver.update(backend.as_mut(), &s, idle, fullscreen);
        }
        if saver.active() {
            thread::sleep(Duration::from_millis(33));
            continue;
        }
        if !clicks.is_empty() {
            log::debug!("desktop clicks: {clicks:?}");
        }

        for m in &s.monitors {
            let (x, y, w, h) = (m.x, m.y, m.width, m.height);
            if m.wallpaper.is_some() && !taken.contains(&m.name) {
                match plasma::take(x, y, w, h) {
                    Ok(original) => {
                        if let Some(o) = original {
                            hub.set_plasma_original(&m.name, Some(o));
                        }
                        taken.insert(m.name.clone());
                    }
                    Err(e) => {
                        log::warn!("{}: {e:#}", m.name);
                        hub.reject(&m.name, format!("Plasma didn't accept the wallpaper: {e:#}"));
                    }
                }
            } else if m.wallpaper.is_none() && taken.remove(&m.name) {
                if let Some(o) = hub.plasma_originals().get(&m.name) {
                    if let Err(e) = plasma::give_back(x, y, w, h, o) {
                        log::warn!("{}: couldn't restore the original wallpaper: {e:#}", m.name);
                    }
                }
                hub.set_plasma_original(&m.name, None);
            }
        }

        if let Some(r) = cond.resting(backend.as_ref(), &s) {
            hub.set_resting(r);
        }
        feed.state(state_json(&s, cond.on_battery));

        if last_signals.elapsed() >= Duration::from_millis(400) {
            last_signals = Instant::now();
            accent.tick(&hub);
            let signals = Signals { fullscreen: backend.fullscreen_active(), idle_ms: backend.idle_ms(), on_battery: crate::desktop::on_battery(), app_running: crate::desktop::any_running(&s.settings.pause_apps), locked: s.settings.pause_locked && crate::desktop::screen_locked() };
            hub.set_auto_pause(pause::evaluate(&s.settings, &signals));
            if last_gpu.elapsed() >= Duration::from_secs(2) {
                last_gpu = Instant::now();
                hub.set_gpu_percent(meter.sample(true));
            }
        }
        let paused = s.paused != PauseReason::None;
        let drawing = s.monitors.iter().any(|m| m.wallpaper.as_deref().is_some_and(|p| kind(p) != "video"));

        if !paused && drawing && feed.connected() {
            if s.settings.interactive {
                for (x, y) in &clicks {
                    log::debug!("ripple at {x},{y}");
                    let (x, y) = to_desk(&s, *x, *y);
                    feed.send(json!({"t": "r", "x": x, "y": y}).to_string());
                }
            }
            let follows = s.monitors.iter().any(|m| m.wallpaper.as_ref().is_some_and(|p| s.params_for(p, &m.name).motion == Motion::Mouse));
            if follows {
                if let Some(p) = backend.pointer() {
                    if (p.x, p.y) != last_pointer {
                        last_pointer = (p.x, p.y);
                        let (x, y) = to_desk(&s, p.x, p.y);
                        feed.send(json!({"t": "p", "x": x, "y": y}).to_string());
                    }
                }
            }
            thread::sleep(Duration::from_secs_f64(1.0 / s.settings.fps_cap.clamp(15, 144) as f64));
        } else {
            thread::sleep(Duration::from_millis(50));
        }
    }


    if hub.quitting() {
        let s = hub.snapshot();
        for m in s.monitors.iter().filter(|m| taken.contains(&m.name)) {
            if let Some(o) = hub.plasma_originals().get(&m.name) {
                if let Err(e) = plasma::give_back(m.x, m.y, m.width, m.height, o) {
                    log::warn!("{}: couldn't restore the original wallpaper: {e:#}", m.name);
                }
            }
            hub.set_plasma_original(&m.name, None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zwall_ipc::Monitor;

    #[test]
    fn feed_describes_each_screen() {
        let mon = |name: &str, x, wallpaper: &str, span: Option<&str>| Monitor {
            name: name.into(),
            x,
            y: 0,
            width: 100,
            height: 50,
            scale: 1.0,
            primary: false,
            wallpaper: Some(wallpaper.into()),
            span: span.map(String::from),
        };
        let mut s = State { monitors: vec![mon("A", 0, "/v/clip.mkv", Some("A+B")), mon("B", 100, "/v/clip.mkv", Some("A+B")), mon("C", 200, "preset://rain", None)], ..Default::default() };
        s.settings.mute = false;

        s.settings.duck_audio = false;
        let v: Value = serde_json::from_str(&state_json(&s, false)).unwrap();
        let m = &v["monitors"];
        assert_eq!(m["A"]["canvas"], json!([0, 0, 200, 50]));
        assert_eq!(m["B"]["rect"], json!([100, 0, 100, 50]));

        assert!(m["A"]["volume"].as_f64().unwrap() > 0.0);
        assert_eq!(m["B"]["volume"], json!(0.0));
        assert_eq!(m["C"]["kind"], "shader");
        assert_eq!(m["C"]["shader"], "rain");
        assert_eq!(m["A"]["url"], "file:///v/clip.mkv");
    }
}
