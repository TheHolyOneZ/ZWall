use crate::{
    backend::{Backend, Rect},
    video::Video,
};
use std::time::Instant;
use zwall_ipc::State;
use zwall_render::{FrameInputs, Gpu, Scene, Source};

enum Show {
    Gpu(Box<Scene>, Rect),

    Video(#[allow(dead_code)] Video),
}

pub struct Saver {
    gpu: Option<Gpu>,
    shows: Vec<(String, Show)>,
    last_idle: u64,
}

impl Saver {
    pub fn new() -> Self {
        Self { gpu: None, shows: Vec::new(), last_idle: 0 }
    }

    pub fn active(&self) -> bool {
        !self.shows.is_empty()
    }

    pub fn update(&mut self, backend: &mut dyn Backend, s: &State, idle_ms: u64, fullscreen: bool) {
        let minutes = s.settings.screensaver_minutes;
        let woke = idle_ms < self.last_idle;
        self.last_idle = idle_ms;
        if self.active() && (woke || minutes == 0 || fullscreen) {
            self.stop(backend);
            return;
        }

        if !self.active() && minutes > 0 && !fullscreen && idle_ms >= minutes as u64 * 60_000 && !crate::desktop::idle_inhibited() {
            self.start(backend, s);
        }
        if let Some(gpu) = &self.gpu {
            for (key, show) in &mut self.shows {
                if let Show::Gpu(scene, r) = show {
                    let f = FrameInputs {
                        canvas: [r.w as f32, r.h as f32],
                        origin: [0.0; 2],
                        cursor: [0.0; 2],
                        speed: 1.0,
                        intensity: 1.0,
                        depth: 1.0,
                        tint: [0.0; 4],
                        ripple: [0.0; 4],
                        grade: crate::conditions::grade(&s.settings, false),
                        layer_amount: 1.0,
                        life: s.params_for(&path_of(key, s), key.strip_prefix("saver:").unwrap_or(key)).life,
                    };
                    if let Err(e) = scene.render(gpu, &f) {
                        log::warn!("{key}: {e:#}");
                    }
                }
            }
        }
    }

    fn start(&mut self, backend: &mut dyn Backend, s: &State) {
        let fallback = s.favourites.first().cloned().unwrap_or_else(|| "preset://aurora".into());
        let t0 = Instant::now();
        for m in &s.monitors {
            let path = m.wallpaper.clone().unwrap_or_else(|| fallback.clone());
            let key = format!("saver:{}", m.name);
            let r = Rect { x: m.x, y: m.y, w: m.width, h: m.height };
            let shown = (|| -> anyhow::Result<Show> {
                if zwall_render::is_video(&path) {
                    let h = backend.create_overlay(&key, r)?;
                    let mut v = Video::new(h.native, &path)?;
                    v.set_volume(0.0);
                    return Ok(Show::Video(v));
                }
                let source = Source::load_photo(&path, s.depths.get(&path).map(String::as_str), s.scenes.get(&path).map(|x| x.map.as_str()))?;
                let h = backend.create_overlay(&key, r)?;
                let gpu = self.gpu.get_or_insert_with(Gpu::new);

                let surface = unsafe { gpu.create_surface(h.display, h.window)? };
                Ok(Show::Gpu(Box::new(Scene::new(gpu, surface, r.w, r.h, &source)?), r))
            })();
            match shown {
                Ok(show) => self.shows.push((key, show)),
                Err(e) => {
                    log::warn!("screensaver on {}: {e:#}", m.name);
                    backend.destroy_surface(&key);
                }
            }
        }
        log::info!("screensaver on ({} screens, {:?})", self.shows.len(), t0.elapsed());
    }

    fn stop(&mut self, backend: &mut dyn Backend) {
        let keys: Vec<String> = self.shows.drain(..).map(|(k, _)| k).collect();
        for k in keys {
            backend.destroy_surface(&k);
        }
        log::info!("screensaver off");
    }
}

fn path_of(key: &str, s: &State) -> String {
    let name = key.strip_prefix("saver:").unwrap_or(key);
    s.monitors.iter().find(|m| m.name == name).and_then(|m| m.wallpaper.clone()).unwrap_or_default()
}
