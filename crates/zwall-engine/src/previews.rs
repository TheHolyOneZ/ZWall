use crate::server::Hub;
use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex, OnceLock},
};

static IN_FLIGHT: Mutex<Vec<String>> = Mutex::new(Vec::new());
static PROBES: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

static LOOKUP: Lane = Lane::new("zwall-preview-cache", 1);
static WORK: Lane = Lane::new("zwall-previews", 2);

type Job = Box<dyn FnOnce() + Send>;

struct Lane {
    name: &'static str,
    workers: usize,
    tx: OnceLock<mpsc::Sender<Job>>,
}

impl Lane {
    const fn new(name: &'static str, workers: usize) -> Self {
        Self { name, workers, tx: OnceLock::new() }
    }

    fn run(&'static self, job: impl FnOnce() + Send + 'static) {
        let tx = self.tx.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<Job>();
            let rx = Arc::new(Mutex::new(rx));
            for i in 0..self.workers {
                let rx = rx.clone();
                std::thread::Builder::new()
                    .name(format!("{}-{i}", self.name))
                    .spawn(move || loop {
                        let next = rx.lock().unwrap().recv();
                        let Ok(job) = next else { break };
                        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(job)).is_err() {
                            log::warn!("{}: a preview job panicked", self.name);
                        }
                    })
                    .expect("spawn preview worker");
            }
            tx
        });
        let _ = tx.send(Box::new(job));
    }
}

fn claim(path: &str) -> bool {
    let mut busy = IN_FLIGHT.lock().unwrap();
    if busy.iter().any(|p| p == path) {
        return false;
    }
    busy.push(path.to_string());
    true
}

fn release(path: &str) {
    IN_FLIGHT.lock().unwrap().retain(|p| p != path);
}

pub fn request(hub: Arc<Hub>, path: String) {
    if zwall_render::is_video(&path) {
        return video(hub, path);
    }
    facts(&hub, &path);
    if zwall_render::is_web(&path) {
        return web(hub, path);
    }
    if !path.starts_with("preset://") {
        photo(hub, path);
    }
}

fn video(hub: Arc<Hub>, path: String) {
    if !claim(&path) {
        return;
    }
    let snap = hub.snapshot();
    let want_thumb = !snap.thumbs.contains_key(&path);
    let want_info = !snap.durations.contains_key(&path) || !snap.facts.contains_key(&path);
    drop(snap);
    if !(want_thumb || want_info) {
        return release(&path);
    }
    LOOKUP.run(move || {
        let (dir, key, bytes) = match cache_key(&path) {
            Ok(k) => k,
            Err(e) => {
                log::warn!("preview for {path}: {e:#}");
                return release(&path);
            }
        };
        let mut want_thumb = want_thumb;
        if want_thumb {
            if let Some(file) = cached_preview(&dir, key) {
                hub.add_thumbnail(path.clone(), file);
                want_thumb = false;
            }
        }
        let mut want_info = want_info;
        if want_info {
            if let Some(info) = read_info(&dir, key) {
                publish_info(&hub, &path, bytes, info);
                want_info = false;
            }
        }
        if !(want_thumb || want_info) {
            return release(&path);
        }
        WORK.run(move || {
            if want_thumb {
                match make(&path, &dir, key) {
                    Ok(file) => hub.add_thumbnail(path.clone(), file),
                    Err(e) => log::warn!("preview for {path}: {e:#}"),
                }
            }
            if want_info {
                let info = probe(&path);
                if let Some(info) = info {
                    let _ = std::fs::write(info_file(&dir, key), format!("{} {} {}", info.0, info.1, info.2));
                }
                publish_info(&hub, &path, bytes, info.unwrap_or((0.0, 0, 0)));
            }
            release(&path);
        });
    });
}

fn cache_key(path: &str) -> anyhow::Result<(PathBuf, u64, u64)> {
    let meta = std::fs::metadata(path)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (path, meta.len(), meta.modified().ok()).hash(&mut h);
    let dir = crate::desktop::cache_dir().ok_or_else(|| anyhow::anyhow!("no cache dir"))?.join("previews");
    std::fs::create_dir_all(&dir)?;
    Ok((dir, h.finish(), meta.len()))
}

fn cached_preview(dir: &Path, key: u64) -> Option<String> {
    [format!("{key:016x}-q82.webp"), format!("{key:016x}-still.jpg")].into_iter().map(|f| dir.join(f)).find(|f| f.exists()).map(|f| f.to_string_lossy().into_owned())
}

fn info_file(dir: &Path, key: u64) -> PathBuf {
    dir.join(format!("{key:016x}-info.txt"))
}

fn read_info(dir: &Path, key: u64) -> Option<(f32, u32, u32)> {
    let text = std::fs::read_to_string(info_file(dir, key)).ok()?;
    let mut parts = text.split_whitespace();
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

fn publish_info(hub: &Hub, path: &str, bytes: u64, (duration, width, height): (f32, u32, u32)) {
    if duration > 0.0 {
        hub.set_duration(path.to_string(), duration);
    }
    hub.set_facts(path.to_string(), zwall_ipc::Facts { width, height, bytes });
}

fn probe(path: &str) -> Option<(f32, u32, u32)> {
    if let (Some(d), Some((w, h))) = (crate::looper::duration(path), crate::looper::video_size(path)) {
        return Some((d, w, h));
    }
    mpv_probe(path)
}

fn facts(hub: &Arc<Hub>, path: &str) {
    if path.starts_with("preset://") || hub.snapshot().facts.contains_key(path) {
        return;
    }
    let (hub, path) = (hub.clone(), path.to_string());
    LOOKUP.run(move || {
        let web = zwall_render::is_web(&path);
        let file = if web { zwall_render::web_entry(&path) } else { path.clone() };
        let bytes = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        let (width, height) = if web { (0, 0) } else { zwall_render::image::image_dimensions(&path).unwrap_or((0, 0)) };
        hub.set_facts(path, zwall_ipc::Facts { width, height, bytes });
    });
}

fn make(path: &str, dir: &Path, key: u64) -> anyhow::Result<String> {
    let out = dir.join(format!("{key:016x}-q82.webp"));
    let still = dir.join(format!("{key:016x}-still.jpg"));
    if let Err(e) = animated(path, &out) {
        still_frame(path, &still).map_err(|e2| anyhow::anyhow!("{e:#}; {e2:#}"))?;
        log::info!("preview: {}", still.display());
        return Ok(still.to_string_lossy().into_owned());
    }
    log::info!("preview: {}", out.display());
    Ok(out.to_string_lossy().into_owned())
}

fn animated(path: &str, out: &Path) -> anyhow::Result<()> {
    let tmp = out.with_extension("tmp.webp");
    let status = crate::desktop::background("ffmpeg")
        .args(["-v", "error", "-y", "-ss", "1", "-t", "4", "-i", path, "-vf", "fps=12,scale=480:-2:flags=lanczos", "-loop", "0", "-c:v", "libwebp_anim", "-quality", "82", "-an"])
        .arg(&tmp)
        .status()
        .map_err(|e| anyhow::anyhow!("ffmpeg not available ({e})"))?;
    anyhow::ensure!(status.success() && tmp.exists(), "ffmpeg failed");
    std::fs::rename(&tmp, out)?;
    Ok(())
}

fn mpv() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        crate::video::mpv_exe()
    }
    #[cfg(not(windows))]
    {
        crate::desktop::on_path("mpv")
    }
}

fn still_frame(path: &str, out: &Path) -> anyhow::Result<()> {
    let exe = mpv().ok_or_else(|| anyhow::anyhow!("mpv not available"))?;
    let tmp = out.with_extension("tmp");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let result = (|| {
        let status = crate::desktop::background(&exe)
            .args(["--no-config", "--no-terminal", "--no-audio", "--start=1", "--frames=1", "--vo=image", "--vo-image-format=jpg", "--vo-image-jpeg-quality=85", "--vf=scale=w=480:h=-2"])
            .arg(format!("--vo-image-outdir={}", tmp.display()))
            .arg("--")
            .arg(path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| anyhow::anyhow!("couldn't start mpv ({}): {e}", exe.display()))?;
        let frame = std::fs::read_dir(&tmp)?.flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|x| x == "jpg"));
        let frame = frame.ok_or_else(|| anyhow::anyhow!("mpv couldn't grab a frame ({status})"))?;
        std::fs::rename(frame, out)?;
        anyhow::Ok(())
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

fn mpv_probe(path: &str) -> Option<(f32, u32, u32)> {
    let exe = mpv()?;
    let dir = crate::desktop::cache_dir()?.join("previews");
    std::fs::create_dir_all(&dir).ok()?;
    let log = dir.join(format!("probe-{}-{}.log", std::process::id(), PROBES.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let status = crate::desktop::background(&exe)
        .args(["--no-config", "--no-terminal", "--no-audio", "--vo=null", "--frames=1", "--term-playing-msg=ZWALL-PROBE ${=duration} ${=width} ${=height}"])
        .arg(format!("--log-file={}", log.display()))
        .arg("--")
        .arg(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    let text = std::fs::read_to_string(&log).unwrap_or_default();
    let _ = std::fs::remove_file(&log);
    status.ok()?;
    parse_probe(&text)
}

fn parse_probe(log: &str) -> Option<(f32, u32, u32)> {
    let line = log.lines().find(|l| l.contains("[term-msg]") && l.contains("ZWALL-PROBE "))?;
    let mut parts = line.split("ZWALL-PROBE ").nth(1)?.split_whitespace();
    let duration = parts.next()?.parse().ok()?;
    let (w, h) = (parts.next().and_then(|w| w.parse().ok()), parts.next().and_then(|h| h.parse().ok()));
    Some((duration, w.unwrap_or(0), h.unwrap_or(0)))
}

fn web(hub: Arc<Hub>, path: String) {
    if hub.snapshot().thumbs.contains_key(&path) || !claim(&path) {
        return;
    }
    WORK.run(move || {
        let result = (|| -> anyhow::Result<String> {
            let entry = zwall_render::web_entry(&path);
            let meta = std::fs::metadata(&entry)?;
            let mut h = std::collections::hash_map::DefaultHasher::new();
            (&entry, meta.len(), meta.modified().ok()).hash(&mut h);
            let dir = crate::desktop::cache_dir().ok_or_else(|| anyhow::anyhow!("no cache dir"))?.join("previews");
            std::fs::create_dir_all(&dir)?;
            let out = dir.join(format!("{:016x}-web.png", h.finish()));
            if !out.exists() {
                let browser = headless_browser().ok_or_else(|| anyhow::anyhow!("no Chromium, Chrome or Edge for web-page previews"))?;
                let status = crate::desktop::background(&browser)
                    .args(["--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--allow-file-access-from-files", "--window-size=1280,720", "--virtual-time-budget=2500"])
                    .arg(format!("--screenshot={}", out.display()))
                    .arg(file_url(&entry))
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()?;
                anyhow::ensure!(status.success() && out.exists(), "{} couldn't render the page", browser.display());
                log::info!("preview: {}", out.display());
            }
            Ok(out.to_string_lossy().into_owned())
        })();
        match result {
            Ok(file) => hub.add_thumbnail(path.clone(), file),
            Err(e) => log::warn!("preview for {path}: {e:#}"),
        }
        release(&path);
    });
}

struct PhotoQueue {
    tx: std::sync::mpsc::Sender<String>,
    queued: std::collections::HashSet<String>,
}

static PHOTOS: Mutex<Option<PhotoQueue>> = Mutex::new(None);

fn photo(hub: Arc<Hub>, path: String) {
    if hub.snapshot().thumbs.contains_key(&path) {
        return;
    }
    let mut q = PHOTOS.lock().unwrap();
    let q = q.get_or_insert_with(|| {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let hub = hub.clone();
        std::thread::Builder::new()
            .name("zwall-thumbs".into())
            .spawn(move || {
                for path in rx {
                    match photo_thumb(&path) {
                        Ok(file) => hub.add_thumbnail(path, file),
                        Err(e) => log::warn!("thumbnail for {path}: {e:#}"),
                    }
                }
            })
            .expect("spawn thumbnail worker");
        PhotoQueue { tx, queued: Default::default() }
    });
    if q.queued.insert(path.clone()) {
        let _ = q.tx.send(path);
    }
}

fn photo_thumb(path: &str) -> anyhow::Result<String> {
    let meta = std::fs::metadata(path)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (path, meta.len(), meta.modified().ok()).hash(&mut h);
    let dir = crate::desktop::cache_dir().ok_or_else(|| anyhow::anyhow!("no cache dir"))?.join("thumbs");
    std::fs::create_dir_all(&dir)?;
    let out = dir.join(format!("{:016x}.jpg", h.finish()));
    if !out.exists() {
        let img = zwall_render::image::open(path)?;
        let small = img.thumbnail(640, 640).to_rgb8();
        let mut f = std::io::BufWriter::new(std::fs::File::create(&out)?);
        zwall_render::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut f, 85).encode_image(&small)?;
    }
    Ok(out.to_string_lossy().into_owned())
}

fn headless_browser() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        let env = |k: &str| std::env::var_os(k).map(std::path::PathBuf::from);
        let candidates = [
            env("ProgramFiles(x86)").map(|p| p.join(r"Microsoft\Edge\Application\msedge.exe")),
            env("ProgramFiles").map(|p| p.join(r"Microsoft\Edge\Application\msedge.exe")),
            env("ProgramFiles").map(|p| p.join(r"Google\Chrome\Application\chrome.exe")),
            env("LOCALAPPDATA").map(|p| p.join(r"Google\Chrome\Application\chrome.exe")),
        ];
        candidates.into_iter().flatten().find(|p| p.is_file())
    }
    #[cfg(not(windows))]
    {
        ["chromium", "google-chrome-stable", "google-chrome", "brave"].into_iter().find_map(crate::desktop::on_path)
    }
}

fn file_url(path: &str) -> String {
    let p = path.replace('\\', "/");
    if p.starts_with('/') { format!("file://{p}") } else { format!("file:///{p}") }
}

#[cfg(test)]
mod tests {
    use super::{file_url, parse_probe};

    #[test]
    fn file_urls_on_both_systems() {
        assert_eq!(file_url("/home/me/a.html"), "file:///home/me/a.html");
        assert_eq!(file_url(r"C:\Users\me\a.html"), "file:///C:/Users/me/a.html");
    }

    #[test]
    fn reads_mpv_probe_line() {
        let log = "[   0.001][v][cplayer] Setting option 'term-playing-msg' = 'ZWALL-PROBE ${=duration} ${=width} ${=height}' (flags = 8)\n[   0.048][i][term-msg] ZWALL-PROBE 36.010667 1920 1080\n";
        assert_eq!(parse_probe(log), Some((36.010667, 1920, 1080)));
        assert_eq!(parse_probe("[   0.048][i][term-msg] ZWALL-PROBE 12.5 (unavailable) (unavailable)"), Some((12.5, 0, 0)));
        assert_eq!(parse_probe("nothing here"), None);
    }
}
