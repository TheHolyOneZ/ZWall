use crate::server::Hub;
use std::{
    hash::{Hash, Hasher},
    path::Path,
    sync::{Arc, Mutex},
};

static IN_FLIGHT: Mutex<Vec<String>> = Mutex::new(Vec::new());
static PROBES: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

pub fn request(hub: Arc<Hub>, path: String) {
    facts(&hub, &path);
    if zwall_render::is_web(&path) {
        return web(hub, path);
    }
    if !zwall_render::is_video(&path) && !path.starts_with("preset://") {
        return photo(hub, path);
    }
    if !zwall_render::is_video(&path) {
        return;
    }
    if !hub.snapshot().durations.contains_key(&path) {
        let (h, p) = (hub.clone(), path.clone());
        std::thread::spawn(move || {
            if let Some(d) = crate::looper::duration(&p).or_else(|| mpv_probe(&p).map(|(d, _, _)| d)) {
                h.set_duration(p, d);
            }
        });
    }
    if hub.snapshot().thumbs.contains_key(&path) {
        return;
    }
    {
        let mut busy = IN_FLIGHT.lock().unwrap();
        if busy.contains(&path) {
            return;
        }
        busy.push(path.clone());
    }
    std::thread::spawn(move || {
        match make(&path) {
            Ok(file) => hub.add_thumbnail(path.clone(), file),
            Err(e) => log::warn!("preview for {path}: {e:#}"),
        }
        IN_FLIGHT.lock().unwrap().retain(|p| p != &path);
    });
}

fn facts(hub: &Arc<Hub>, path: &str) {
    if path.starts_with("preset://") || hub.snapshot().facts.contains_key(path) {
        return;
    }
    let (hub, path) = (hub.clone(), path.to_string());
    std::thread::spawn(move || {
        let web = zwall_render::is_web(&path);
        let file = if web { zwall_render::web_entry(&path) } else { path.clone() };
        let bytes = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        let (width, height) = if web {
            (0, 0)
        } else if zwall_render::is_video(&path) {
            crate::looper::video_size(&path).or_else(|| mpv_probe(&path).map(|(_, w, h)| (w, h))).unwrap_or((0, 0))
        } else {
            zwall_render::image::image_dimensions(&path).unwrap_or((0, 0))
        };
        hub.set_facts(path, zwall_ipc::Facts { width, height, bytes });
    });
}

fn make(path: &str) -> anyhow::Result<String> {
    let meta = std::fs::metadata(path)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (path, meta.len(), meta.modified().ok()).hash(&mut h);
    let key = h.finish();
    let dir = crate::desktop::cache_dir().ok_or_else(|| anyhow::anyhow!("no cache dir"))?.join("previews");
    std::fs::create_dir_all(&dir)?;
    let out = dir.join(format!("{key:016x}-q82.webp"));
    let still = dir.join(format!("{key:016x}-still.jpg"));
    if out.exists() {
        return Ok(out.to_string_lossy().into_owned());
    }
    if still.exists() {
        return Ok(still.to_string_lossy().into_owned());
    }
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
    let status = crate::desktop::command("ffmpeg")
        .args(["-v", "error", "-y", "-ss", "1", "-t", "4", "-i", path, "-vf", "fps=12,scale=480:-2:flags=lanczos", "-loop", "0", "-c:v", "libwebp_anim", "-quality", "82", "-an"])
        .arg(&tmp)
        .status()
        .map_err(|e| anyhow::anyhow!("ffmpeg not available ({e})"))?;
    anyhow::ensure!(status.success() && tmp.exists(), "ffmpeg failed");
    std::fs::rename(&tmp, out)?;
    Ok(())
}

fn mpv() -> Option<std::path::PathBuf> {
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
        let status = crate::desktop::command(&exe)
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
    let status = crate::desktop::command(&exe)
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
    if hub.snapshot().thumbs.contains_key(&path) {
        return;
    }
    {
        let mut busy = IN_FLIGHT.lock().unwrap();
        if busy.contains(&path) {
            return;
        }
        busy.push(path.clone());
    }
    std::thread::spawn(move || {
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
                let status = crate::desktop::command(&browser)
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
        IN_FLIGHT.lock().unwrap().retain(|p| p != &path);
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
