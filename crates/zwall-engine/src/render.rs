

use crate::{
    backend::{Backend, Rect},
    pause::{self, Signals},
    server::Hub,
    video::Video,
};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use zwall_ipc::{Motion, PauseReason, State, Tint};
use zwall_render::{FrameInputs, Gpu, Scene, Source};


const RIPPLE_SECS: f32 = 2.5;

enum Player {
    Gpu(Box<Scene>),
    Video(Video),
}

struct Live {
    path: String,
    depth: Option<String>,
    scene: Option<String>,
    rect: Rect,
    player: Player,
    cursor: [f32; 2],
    ripple: Option<([f32; 2], Instant)>,
}


fn desired(s: &State) -> BTreeMap<String, (String, Rect)> {
    let mut out = BTreeMap::new();
    for m in &s.monitors {
        let Some(path) = &m.wallpaper else { continue };
        match &m.span {
            None => {
                out.insert(m.name.clone(), (path.clone(), Rect { x: m.x, y: m.y, w: m.width, h: m.height }));
            }
            Some(group) => {
                let members: Vec<_> = s.monitors.iter().filter(|o| o.span.as_ref() == Some(group)).collect();
                let x0 = members.iter().map(|o| o.x).min().unwrap();
                let y0 = members.iter().map(|o| o.y).min().unwrap();
                let x1 = members.iter().map(|o| o.x + o.width as i32).max().unwrap();
                let y1 = members.iter().map(|o| o.y + o.height as i32).max().unwrap();
                out.insert(format!("span:{group}"), (path.clone(), Rect { x: x0, y: y0, w: (x1 - x0) as u32, h: (y1 - y0) as u32 }));
            }
        }
    }
    out
}


pub fn render_thumbnails(gpu: &mut Gpu) -> BTreeMap<String, String> {
    use std::hash::{Hash, Hasher};
    let mut out = BTreeMap::new();
    let Some(dir) = crate::desktop::cache_dir().map(|d| d.join("thumbs")) else { return out };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!("thumbnails: {e}");
        return out;
    }
    for (name, src) in zwall_render::PRESETS {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (src, zwall_render::COMMON_VERSION).hash(&mut h);
        let file = dir.join(format!("{name}-{:08x}.png", h.finish() as u32));
        if !file.exists() {

            match zwall_render::snapshot(gpu, &Source::Shader(src), 960, 540, 7.5).and_then(|img| Ok(img.save(&file)?)) {
                Ok(()) => log::info!("thumbnail: {}", file.display()),
                Err(e) => {
                    log::warn!("thumbnail {name}: {e:#}");
                    continue;
                }
            }
        }
        out.insert(format!("preset://{name}"), file.to_string_lossy().into_owned());
    }
    out
}

pub fn run(hub: Arc<Hub>, mut backend: Box<dyn Backend>, stop: Arc<AtomicBool>) {
    let mut gpu = Gpu::new();
    hub.set_thumbnails(render_thumbnails(&mut gpu));
    if let Some(name) = gpu.adapter_name() {
        hub.set_gpu(name);
    }
    let mut live: HashMap<String, Live> = HashMap::new();
    let started = Instant::now();
    let mut hotkeys_on: Option<bool> = None;
    let mut cond = crate::conditions::Conditions::new();
    let mut saver = crate::saver::Saver::new();
    let mut last_saver = Instant::now();
    let mut meter = crate::gpu::Meter::new();
    let mut last_gpu = Instant::now();
    let mut last_signals = Instant::now() - Duration::from_secs(1);

    while !stop.load(Ordering::Relaxed) && !hub.quitting() {
        let frame_start = Instant::now();
        let s = hub.snapshot();
        crate::automation::tick(&hub);
        crate::blend::tick(&hub);
        crate::depth::scan(&hub);
        let want = desired(&s);
        let input = backend.pump();
        if backend.surfaces_lost() {
            log::warn!("the desktop dropped our wallpaper surfaces; recreating them");
            live.clear();
        }
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


        let stale: Vec<String> = live
            .iter()
            .filter(|(k, l)| want.get(*k).is_none_or(|(p, r)| *p != l.path || *r != l.rect || s.depths.get(p) != l.depth.as_ref() || s.scenes.get(p).map(|x| &x.map) != l.scene.as_ref()))
            .map(|(k, _)| k.clone())
            .collect();
        for k in stale {
            drop(live.remove(&k));
            backend.destroy_surface(&k);
        }
        for (key, (path, rect)) in &want {
            if live.contains_key(key) {
                continue;
            }
            let depth = s.depths.get(path).cloned();
            let scene = s.scenes.get(path).map(|x| x.map.clone());
            match start(&mut gpu, backend.as_mut(), key, path, depth.as_deref(), scene.as_deref(), *rect) {
                Ok(player) => {
                    log::info!("{key}: playing {path}");
                    live.insert(key.clone(), Live { path: path.clone(), depth, scene, rect: *rect, player, cursor: [0.0; 2], ripple: None });
                }
                Err(e) => {
                    log::warn!("{key}: {e:#}");
                    backend.destroy_surface(key);
                    let monitors: Vec<String> = match key.strip_prefix("span:") {
                        Some(g) => g.split('+').map(String::from).collect(),
                        None => vec![key.clone()],
                    };
                    for m in monitors {
                        hub.reject(&m, format!("{e:#}"));
                    }
                }
            }
        }

        if last_signals.elapsed() >= Duration::from_millis(400) {
            last_signals = Instant::now();
            let signals = Signals { fullscreen: backend.fullscreen_active(), idle_ms: backend.idle_ms(), on_battery: crate::desktop::on_battery(), app_running: crate::desktop::any_running(&s.settings.pause_apps), locked: s.settings.pause_locked && crate::desktop::screen_locked() };
            hub.set_auto_pause(pause::evaluate(&s.settings, &signals));
            if last_gpu.elapsed() >= Duration::from_secs(2) {
                last_gpu = Instant::now();
                hub.set_gpu_percent(meter.sample(false));
            }
        }
        if let Some(r) = cond.resting(backend.as_ref(), &s) {
            hub.set_resting(r);
        }
        let (fps_cap, quality) = crate::conditions::effective(&s.settings, cond.on_battery);
        let paused = s.paused != PauseReason::None;


        let mut heard: Vec<&str> = Vec::new();
        let mut keys: Vec<&String> = live.keys().collect();
        keys.sort();
        let mut audible = HashMap::new();
        for k in keys {
            let l = &live[k];
            if matches!(l.player, Player::Video(_)) && !heard.contains(&l.path.as_str()) {
                heard.push(&l.path);
                audible.insert(k.clone(), true);
            }
        }
        for (k, l) in live.iter_mut() {
            if let Player::Video(v) = &mut l.player {
                let params = s.params_for(&l.path, k);
                let rest = crate::conditions::rest_of(k, &s.resting);
                v.set_paused(paused || rest == Some("paused"));
                v.set_speed(params.speed as f64 * if rest == Some("calm") { 0.3 } else { 1.0 });
                let on = audible.contains_key(k) && !crate::desktop::muted(&s.settings);
                v.set_volume(if on { s.settings.volume as f64 * params.volume as f64 } else { 0.0 });
                v.draw();
            }
        }

        let gpu_scenes = live.values().any(|l| matches!(l.player, Player::Gpu(_)));
        if paused || !gpu_scenes {

            let wl_video = !paused && backend.name() != "x11" && live.values().any(|l| matches!(l.player, Player::Video(_)));
            let tick = if wl_video { 1000 / fps_cap.clamp(15, 144) as u64 } else if paused { 100 } else { 50 };
            thread::sleep(Duration::from_millis(tick));
            continue;
        }

        let pointer = backend.pointer();

        let click = clicks.last().copied().filter(|_| s.settings.interactive);

        let accent = s.accent.as_deref().and_then(crate::desktop::parse_hex).unwrap_or([0.70, 0.36, 1.0]);
        let secs = started.elapsed().as_secs_f32();
        for (key, l) in live.iter_mut() {
            let Player::Gpu(scene) = &mut l.player else { continue };
            let rest = crate::conditions::rest_of(key, &s.resting);
            if rest == Some("paused") {
                continue;
            }
            let r = l.rect;
            let params = s.params_for(&l.path, key);
            let target = match (params.motion, pointer) {
                (Motion::Mouse, Some(p)) => [((p.x - r.x) as f32 / r.w as f32 * 2.0 - 1.0).clamp(-1.5, 1.5), ((p.y - r.y) as f32 / r.h as f32 * 2.0 - 1.0).clamp(-1.5, 1.5)],

                (Motion::Drift, _) => [(secs * 0.16).sin() * 0.8, (secs * 0.11).sin() * 0.6],
                _ => [0.0, 0.0],
            };

            for (c, t) in l.cursor.iter_mut().zip(target) {
                *c += (t - *c) * 0.06;
            }
            if let Some((x, y)) = click {
                if x >= r.x && y >= r.y && x < r.x + r.w as i32 && y < r.y + r.h as i32 {
                    log::debug!("{key}: ripple at {x},{y}");
                    l.ripple = Some(([(x - r.x) as f32, (y - r.y) as f32], Instant::now()));
                }
            }
            let ripple = match l.ripple {
                Some((at, t0)) if t0.elapsed().as_secs_f32() < RIPPLE_SECS => [at[0], at[1], t0.elapsed().as_secs_f32(), 1.0],
                _ => [0.0; 4],
            };
            let tint = match params.tint {
                Tint::Original => [0.0; 4],
                Tint::Accent => [accent[0], accent[1], accent[2], 1.0],
                Tint::Mono => [0.0, 0.0, 0.0, 2.0],
            };
            scene.set_quality(&gpu, quality);
            scene.set_layer(&gpu, params.overlay.name());
            let calm = rest == Some("calm");
            let inputs = FrameInputs {
                canvas: [r.w as f32, r.h as f32],
                origin: [0.0; 2],
                cursor: l.cursor,
                speed: if calm { params.speed * 0.3 } else { params.speed },
                intensity: params.intensity,
                depth: params.depth,
                tint,
                ripple,
                grade: crate::conditions::grade(&s.settings, calm),
                layer_amount: params.overlay_amount,
                life: params.life,
            };
            if let Err(e) = scene.render(&gpu, &inputs) {
                log::warn!("{key}: render failed: {e:#}");
            }
        }

        let budget = Duration::from_secs_f64(1.0 / fps_cap.max(1) as f64);
        if let Some(rest) = budget.checked_sub(frame_start.elapsed()) {
            thread::sleep(rest);
        }
    }


    let keys: Vec<String> = live.keys().cloned().collect();
    drop(live);
    for k in keys {
        backend.destroy_surface(&k);
    }
}

fn start(gpu: &mut Gpu, backend: &mut dyn Backend, key: &str, path: &str, depth: Option<&str>, scene: Option<&str>, rect: Rect) -> anyhow::Result<Player> {
    if zwall_render::is_video(path) {
        anyhow::ensure!(std::path::Path::new(path).exists(), "{path} no longer exists");
        let handles = backend.create_surface(key, rect)?;
        #[cfg(target_os = "linux")]
        if let (raw_window_handle::RawDisplayHandle::Wayland(d), raw_window_handle::RawWindowHandle::Wayland(w)) = (handles.display, handles.window) {
            return Ok(Player::Video(Video::new_wayland(d.display.as_ptr(), w.surface.as_ptr(), rect.w, rect.h, path)?));
        }
        return Ok(Player::Video(Video::new(handles.native, path)?));
    }

    let source = Source::load_photo(path, depth, scene)?;
    let handles = backend.create_surface(key, rect)?;

    let surface = unsafe { gpu.create_surface(handles.display, handles.window)? };
    Ok(Player::Gpu(Box::new(Scene::new(gpu, surface, rect.w, rect.h, &source)?)))
}
