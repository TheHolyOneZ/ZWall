use crate::server::Hub;
use std::{
    hash::{Hash, Hasher},
    path::Path,
    sync::{Arc, Mutex},
};

static IN_FLIGHT: Mutex<Vec<String>> = Mutex::new(Vec::new());

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
            if let Some(d) = crate::looper::duration(&p) {
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
            crate::looper::video_size(&path).unwrap_or((0, 0))
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
    let dir = crate::desktop::cache_dir().ok_or_else(|| anyhow::anyhow!("no cache dir"))?.join("previews");
    std::fs::create_dir_all(&dir)?;
    let out = dir.join(format!("{:016x}-q82.webp", h.finish()));
    if !out.exists() {
        let tmp = out.with_extension("tmp.webp");

        let status = crate::desktop::command("ffmpeg")
            .args(["-v", "error", "-y", "-ss", "1", "-t", "4", "-i", path, "-vf", "fps=12,scale=480:-2:flags=lanczos", "-loop", "0", "-c:v", "libwebp_anim", "-quality", "82", "-an"])
            .arg(&tmp)
            .status()
            .map_err(|e| anyhow::anyhow!("ffmpeg not available ({e})"))?;
        anyhow::ensure!(status.success() && Path::new(&tmp).exists(), "ffmpeg failed");
        std::fs::rename(&tmp, &out)?;
        log::info!("preview: {}", out.display());
    }
    Ok(out.to_string_lossy().into_owned())
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
    use super::file_url;

    #[test]
    fn file_urls_on_both_systems() {
        assert_eq!(file_url("/home/me/a.html"), "file:///home/me/a.html");
        assert_eq!(file_url(r"C:\Users\me\a.html"), "file:///C:/Users/me/a.html");
    }
}
