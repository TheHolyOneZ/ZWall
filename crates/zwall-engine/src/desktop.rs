use std::path::PathBuf;

#[cfg(windows)]
#[path = "desktop_windows.rs"]
mod win;
#[cfg(windows)]
pub use win::{accent, cache_dir, config_dir, data_dir, idle_inhibited, on_battery, others_playing, screen_locked};

pub fn command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

pub fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(name)).find(|p| p.is_file())
}

#[cfg(not(windows))]
pub fn accent() -> Option<String> {
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    let text = std::fs::read_to_string(config.join("kdeglobals")).ok()?;
    let mut section = "";
    let (mut accent, mut selection) = (None, None);
    for line in text.lines() {
        let line = line.trim();
        if let Some(s) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = s;
        } else if let Some((k, v)) = line.split_once('=') {
            match (section, k.trim()) {
                ("General", "AccentColor") => accent = rgb(v),
                ("Colors:Selection", "BackgroundNormal") => selection = rgb(v),
                _ => {}
            }
        }
    }
    accent.or(selection)
}

#[cfg_attr(windows, allow(dead_code))]
fn rgb(v: &str) -> Option<String> {
    let v = v.trim();
    if v.starts_with('#') && v.len() == 7 {
        return Some(v.to_lowercase());
    }
    let p: Vec<u8> = v.split(',').map(|n| n.trim().parse().ok()).collect::<Option<_>>()?;
    (p.len() >= 3).then(|| format!("#{:02x}{:02x}{:02x}", p[0], p[1], p[2]))
}

pub fn parse_hex(hex: &str) -> Option<[f32; 3]> {
    let h = hex.strip_prefix('#')?;
    let n = u32::from_str_radix(h, 16).ok()?;
    Some([((n >> 16) & 255) as f32 / 255.0, ((n >> 8) & 255) as f32 / 255.0, (n & 255) as f32 / 255.0])
}

#[cfg(not(windows))]
pub fn data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|| "/tmp".into())
        .join("zwall")
}

#[cfg(not(windows))]
pub fn cache_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))?;
    Some(base.join("zwall"))
}

#[cfg(not(windows))]
pub fn config_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("zwall"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_kde_colours() {
        assert_eq!(rgb("61,174,233").as_deref(), Some("#3daee9"));
        assert_eq!(rgb("#ABCDEF").as_deref(), Some("#abcdef"));
        assert_eq!(parse_hex("#ff0000"), Some([1.0, 0.0, 0.0]));
    }
}

#[cfg(not(windows))]
pub fn on_battery() -> bool {
    let Ok(dir) = std::fs::read_dir("/sys/class/power_supply") else { return false };
    let mut saw_mains = false;
    for e in dir.flatten() {
        let p = e.path();
        if std::fs::read_to_string(p.join("type")).is_ok_and(|t| t.trim() == "Mains") {
            saw_mains = true;
            if std::fs::read_to_string(p.join("online")).is_ok_and(|o| o.trim() == "1") {
                return false;
            }
        }
    }
    saw_mains
}

pub fn any_running(names: &[String]) -> bool {
    if names.is_empty() {
        return false;
    }
    let wanted: Vec<String> = names.iter().map(|n| n.trim().to_lowercase()).filter(|n| !n.is_empty()).collect();
    running_names().iter().any(|p| wanted.iter().any(|w| p.starts_with(w.as_str())))
}

#[cfg(windows)]
pub fn running_names() -> Vec<String> {
    win::process_names()
}

#[cfg(not(windows))]
pub fn running_names() -> Vec<String> {
    let Ok(dir) = std::fs::read_dir("/proc") else { return Vec::new() };
    dir.flatten()
        .filter(|e| e.file_name().to_string_lossy().bytes().all(|b| b.is_ascii_digit()))
        .filter_map(|e| std::fs::read_to_string(e.path().join("comm")).ok())
        .map(|c| c.trim().to_lowercase())
        .filter(|c| !c.is_empty())
        .collect()
}

#[cfg(not(windows))]
pub fn idle_inhibited() -> bool {
    std::process::Command::new("qdbus6")
        .args(["org.freedesktop.PowerManagement.Inhibit", "/org/freedesktop/PowerManagement/Inhibit", "org.freedesktop.PowerManagement.Inhibit.HasInhibit"])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
}

#[cfg_attr(windows, allow(dead_code))]
fn cached(slot: &std::sync::Mutex<Option<(std::time::Instant, bool)>>, ask: impl FnOnce() -> bool) -> bool {
    let mut c = slot.lock().unwrap();
    if let Some((t, v)) = *c {
        if t.elapsed() < std::time::Duration::from_secs(2) {
            return v;
        }
    }
    let v = ask();
    *c = Some((std::time::Instant::now(), v));
    v
}

#[cfg(not(windows))]
pub fn screen_locked() -> bool {
    static C: std::sync::Mutex<Option<(std::time::Instant, bool)>> = std::sync::Mutex::new(None);
    cached(&C, || {
        std::process::Command::new("qdbus6")
            .args(["org.freedesktop.ScreenSaver", "/ScreenSaver", "org.freedesktop.ScreenSaver.GetActive"])
            .output()
            .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
    })
}

#[cfg(not(windows))]
pub fn others_playing() -> bool {
    static C: std::sync::Mutex<Option<(std::time::Instant, bool)>> = std::sync::Mutex::new(None);
    cached(&C, || {
        let Ok(o) = std::process::Command::new("pactl").args(["-f", "json", "list", "sink-inputs"]).output() else { return false };
        let Ok(v) = serde_json::from_slice::<serde_json::Value>(&o.stdout) else { return false };
        v.as_array().into_iter().flatten().any(|i| {
            let p = &i["properties"];
            let who = format!("{} {}", p["application.name"].as_str().unwrap_or(""), p["application.process.binary"].as_str().unwrap_or("")).to_lowercase();
            i["corked"].as_bool() == Some(false) && !who.trim().is_empty() && !who.contains("zwall") && !who.contains("plasmashell") && !who.contains("qtwebengine")
        })
    })
}

pub fn muted(settings: &zwall_ipc::Settings) -> bool {
    settings.mute || (settings.duck_audio && others_playing())
}
