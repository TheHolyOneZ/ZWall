use crate::server::Hub;
use std::{
    collections::HashSet,
    hash::{Hash, Hasher},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

struct Worker {
    tx: mpsc::Sender<String>,
    queued: HashSet<String>,
}

static WORKER: Mutex<Option<Worker>> = Mutex::new(None);
static LAST_SCAN: Mutex<Option<Instant>> = Mutex::new(None);

fn is_photo(path: &str) -> bool {
    !path.starts_with("preset://") && !zwall_render::is_video(path) && !zwall_render::is_web(path)
}

pub fn scan(hub: &Arc<Hub>) {
    {
        let mut last = LAST_SCAN.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < Duration::from_secs(2)) {
            return;
        }
        *last = Some(Instant::now());
    }
    let s = hub.snapshot();

    for (key, params) in &s.params {
        let p = zwall_ipc::key_path(key);
        if is_photo(p) && ((params.depth > 0.0 && !s.depths.contains_key(p)) || (params.life > 0.0 && !s.scenes.contains_key(p))) {
            request(hub, p.to_string());
        }
    }
}

pub fn request(hub: &Arc<Hub>, path: String) {
    if !is_photo(&path) {
        return;
    }
    let mut w = WORKER.lock().unwrap();
    let w = w.get_or_insert_with(|| {
        let (tx, rx) = mpsc::channel::<String>();
        let hub = hub.clone();
        std::thread::Builder::new().name("zwall-depth".into()).spawn(move || run(hub, rx)).expect("spawn depth worker");
        Worker { tx, queued: HashSet::new() }
    });
    if w.queued.insert(path.clone()) {
        let _ = w.tx.send(path);
    }
}

fn run(hub: Arc<Hub>, rx: mpsc::Receiver<String>) {
    let mut model: Option<zwall_depth::DepthModel> = None;
    let mut scene_model: Option<zwall_depth::segment::SceneModel> = None;
    for path in rx {
        let snap = hub.snapshot();
        let mut wants = zwall_ipc::Params::default();
        for (k, p) in snap.params.iter().filter(|(k, _)| zwall_ipc::key_path(k) == path) {
            let _ = k;
            wants.depth = wants.depth.max(p.depth);
            wants.life = wants.life.max(p.life);
        }
        hub.set_job(&path, Some("Finding depth…".into()));
        let result = (|| -> anyhow::Result<String> {
            anyhow::ensure!(wants.depth > 0.0, "skipped");
            let cache = crate::desktop::cache_dir().ok_or_else(|| anyhow::anyhow!("no cache dir"))?;
            let meta = std::fs::metadata(&path)?;
            let mut h = std::collections::hash_map::DefaultHasher::new();
            (&path, meta.len(), meta.modified().ok()).hash(&mut h);
            let out = cache.join("depth").join(format!("{:016x}.png", h.finish()));
            if !out.exists() {
                log::info!("depth: analysing {path}");
                if model.is_none() {
                    let file = zwall_depth::ensure_model(&cache.join("models"))?;
                    model = Some(zwall_depth::DepthModel::load(&file)?);
                }
                let photo = zwall_render::image::open(&path)?.to_rgb8();
                let t = Instant::now();
                let depth = model.as_mut().unwrap().estimate(&photo)?;
                std::fs::create_dir_all(out.parent().unwrap())?;
                depth.to_image(1024).save(&out)?;
                log::info!("depth: {path} in {:?}", t.elapsed());
            }
            Ok(out.to_string_lossy().into_owned())
        })();
        match result {
            Ok(png) => hub.set_depth(path.clone(), png),
            Err(e) if e.to_string() == "skipped" => {}
            Err(e) => log::warn!("depth for {path}: {e:#}"),
        }
        if wants.life <= 0.0 {
            hub.set_job(&path, None);
            queued_done(&path);
            continue;
        }

        hub.set_job(&path, Some("Looking at what's in it…".into()));
        let scene = (|| -> anyhow::Result<zwall_ipc::SceneInfo> {
            let cache = crate::desktop::cache_dir().ok_or_else(|| anyhow::anyhow!("no cache dir"))?;
            let meta = std::fs::metadata(&path)?;
            let mut h = std::collections::hash_map::DefaultHasher::new();
            ("motion-v2", &path, meta.len(), meta.modified().ok()).hash(&mut h);
            let base = cache.join("scene").join(format!("{:016x}", h.finish()));
            let (png, txt) = (base.with_extension("png"), base.with_extension("txt"));
            if !png.exists() || !txt.exists() {
                if scene_model.is_none() {
                    let file = zwall_depth::segment::ensure_model(&cache.join("models"))?;
                    scene_model = Some(zwall_depth::segment::SceneModel::load(&file)?);
                }
                let photo = zwall_render::image::open(&path)?.to_rgb8();
                let (map, found) = scene_model.as_mut().unwrap().motion_map(&photo, 1024)?;
                std::fs::create_dir_all(png.parent().unwrap())?;
                map.save(&png)?;
                std::fs::write(&txt, found.names().join(","))?;
                log::info!("scene: {path} has {:?}", found.names());
            }
            let found = std::fs::read_to_string(&txt)?.split(',').filter(|s| !s.is_empty()).map(String::from).collect();
            Ok(zwall_ipc::SceneInfo { map: png.to_string_lossy().into_owned(), found })
        })();
        hub.set_job(&path, None);
        queued_done(&path);
        match scene {
            Ok(info) => hub.set_scene(path, info),
            Err(e) => log::warn!("scene for {path}: {e:#}"),
        }
    }
}

fn queued_done(path: &str) {
    if let Some(w) = WORKER.lock().unwrap().as_mut() {
        w.queued.remove(path);
    }
}
