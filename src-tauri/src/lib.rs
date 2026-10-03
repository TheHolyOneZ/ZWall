

mod link;
mod tray;

use link::Link;
use std::{path::Path, sync::Arc};
use tauri::{AppHandle, Manager};
use zwall_ipc::Request;

pub const MAIN: &str = "main";

#[tauri::command]
fn send(link: tauri::State<'_, Arc<Link>>, req: Request) -> Result<(), String> {
    link.send(&req).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct Snapshot {
    connected: bool,
    state: Option<zwall_ipc::State>,
}

#[tauri::command]
fn snapshot(link: tauri::State<'_, Arc<Link>>) -> Snapshot {
    Snapshot { connected: link.connected(), state: link.state() }
}

fn engine_path() -> std::path::PathBuf {
    let name = if cfg!(windows) { "zwall-engine.exe" } else { "zwall-engine" };
    std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(name))).filter(|p| p.exists()).unwrap_or_else(|| name.into())
}


fn quiet(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}


#[cfg(not(windows))]
fn autostart_file() -> Option<std::path::PathBuf> {
    let config = std::env::var_os("XDG_CONFIG_HOME").map(std::path::PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config")))?;
    Some(config.join("autostart").join("zwall-engine.desktop"))
}

#[cfg(not(windows))]
#[tauri::command]
fn autostart() -> bool {
    autostart_file().is_some_and(|f| f.exists())
}

#[cfg(not(windows))]
#[tauri::command]
fn set_autostart(on: bool) -> Result<bool, String> {
    let file = autostart_file().ok_or("no config directory")?;
    if on {
        std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
        let entry = format!(
            "[Desktop Entry]\nType=Application\nName=ZWall engine\nComment=Plays your ZWall wallpapers\nExec=\"{}\"\nIcon=zwall\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n",
            engine_path().display()
        );
        std::fs::write(&file, entry).map_err(|e| e.to_string())?;
    } else if file.exists() {
        std::fs::remove_file(&file).map_err(|e| e.to_string())?;
    }
    Ok(autostart())
}


#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[cfg(windows)]
#[tauri::command]
fn autostart() -> bool {
    quiet("reg").args(["query", RUN_KEY, "/v", "ZWall"]).output().is_ok_and(|o| o.status.success())
}

#[cfg(windows)]
#[tauri::command]
fn set_autostart(on: bool) -> Result<bool, String> {
    let out = if on {
        let value = format!("\"{}\"", engine_path().display());
        quiet("reg").args(["add", RUN_KEY, "/v", "ZWall", "/t", "REG_SZ", "/d", &value, "/f"]).output()
    } else {
        quiet("reg").args(["delete", RUN_KEY, "/v", "ZWall", "/f"]).output()
    };
    let out = out.map_err(|e| e.to_string())?;
    if !out.status.success() && on {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(autostart())
}


#[cfg(not(windows))]
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    let uri = format!("file://{path}");
    let shown = std::process::Command::new("dbus-send")
        .args(["--session", "--dest=org.freedesktop.FileManager1", "--type=method_call", "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems", &format!("array:string:{uri}"), "string:"])
        .status()
        .is_ok_and(|s| s.success());
    if shown {
        return Ok(());
    }
    let dir = std::path::Path::new(&path).parent().ok_or("no folder")?;
    std::process::Command::new("xdg-open").arg(dir).spawn().map(drop).map_err(|e| e.to_string())
}


#[cfg(windows)]
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let path = path.replace('/', "\\");
    std::process::Command::new("explorer").raw_arg(format!("/select,\"{path}\"")).spawn().map(drop).map_err(|e| e.to_string())
}


#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("not a web link".into());
    }
    #[cfg(windows)]
    let mut c = {

        let mut c = quiet("cmd");
        c.args(["/c", "start", ""]).arg(&url);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    c.spawn().map(drop).map_err(|e| e.to_string())
}

#[tauri::command]
fn wake_engine() -> Result<(), String> {
    wake_engine_now()
}


pub fn wake_engine_now() -> Result<(), String> {
    quiet(engine_path()).spawn().map(drop).map_err(|e| format!("could not start zwall-engine: {e}"))
}


static WINDOW_GLASS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);


#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn window_glass() -> bool {
    WINDOW_GLASS.load(std::sync::atomic::Ordering::Relaxed)
}

fn enable_window_glass(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {

        use windows::Win32::{Foundation::HWND, Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND}};
        if let Ok(hwnd) = window.hwnd() {
            let pref = DWMWCP_ROUND;

            let _ = unsafe { DwmSetWindowAttribute(HWND(hwnd.0), DWMWA_WINDOW_CORNER_PREFERENCE, &pref as *const _ as *const _, std::mem::size_of_val(&pref) as u32) };
        }
        WINDOW_GLASS.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(target_os = "linux")]
    {
        let kde = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().split(':').any(|d| d.eq_ignore_ascii_case("kde"));
        if !kde {
            return;
        }
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        let Ok(handle) = window.window_handle() else { return };
        let RawWindowHandle::Xlib(xlib) = handle.as_raw() else { return };
        let xid = xlib.window as u32;
        if kde_blur(xid, window).is_ok() {
            WINDOW_GLASS.store(true, std::sync::atomic::Ordering::Relaxed);


            let w = window.clone();
            window.on_window_event(move |e| {
                if matches!(e, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
                    let _ = kde_blur(xid, &w);
                }
            });
        }
    }
}


#[cfg(target_os = "linux")]
fn kde_blur(window: u32, win: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use x11rb::{connection::Connection, protocol::xproto::{AtomEnum, ConnectionExt, PropMode}, wrapper::ConnectionExt as _};
    let size = win.inner_size()?;
    let (w, h) = (size.width, size.height);
    let r = if win.is_maximized().unwrap_or(false) { 0 } else { (12.0 * win.scale_factor().unwrap_or(1.0)).round() as u32 };
    let r = r.min(w / 2).min(h / 2);
    let mut rects: Vec<u32> = Vec::new();
    for y in 0..r {
        let dy = r as f64 - y as f64 - 0.5;
        let inset = (r as f64 - (r as f64 * r as f64 - dy * dy).max(0.0).sqrt()).round() as u32;
        let width = w.saturating_sub(2 * inset);
        rects.extend([inset, y, width, 1, inset, h - 1 - y, width, 1]);
    }
    rects.extend([0, r, w, h.saturating_sub(2 * r)]);
    let (conn, _) = x11rb::connect(None)?;
    let atom = conn.intern_atom(false, b"_KDE_NET_WM_BLUR_BEHIND_REGION")?.reply()?.atom;
    conn.change_property32(PropMode::REPLACE, window, atom, AtomEnum::CARDINAL, &rects)?;
    conn.flush()?;
    Ok(())
}


#[derive(serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum Intake {
    Parallax,
    Video,
    Shader,
    Web,
    Zwall,

    Folder,
    Unsupported,
}


#[tauri::command]
fn classify(path: String) -> Intake {
    if Path::new(&path).join("index.html").is_file() {
        return Intake::Web;
    }
    if Path::new(&path).is_dir() {
        return Intake::Folder;
    }
    let ext = Path::new(&path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "avif" | "heic" => Intake::Parallax,
        "mp4" | "webm" | "mkv" | "mov" | "gif" => Intake::Video,
        "wgsl" => Intake::Shader,
        "html" | "htm" => Intake::Web,
        "zwall" => Intake::Zwall,
        _ => Intake::Unsupported,
    }
}


#[tauri::command]
fn wallpaper_engine_folder() -> Option<String> {
    let env = |k: &str| std::env::var_os(k).map(std::path::PathBuf::from);
    let mut steam_roots: Vec<std::path::PathBuf> = Vec::new();
    if let Some(home) = env("HOME") {
        steam_roots.extend([home.join(".local/share/Steam"), home.join(".steam/steam"), home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam")]);
    }

    steam_roots.extend(env("ProgramFiles(x86)").map(|p| p.join("Steam")));
    steam_roots.extend(env("ProgramFiles").map(|p| p.join("Steam")));
    let mut libraries: Vec<std::path::PathBuf> = steam_roots.to_vec();
    for root in &steam_roots {
        if let Ok(vdf) = std::fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {


            for line in vdf.lines().filter(|l| l.trim_start().starts_with("\"path\"")) {
                if let Some(p) = line.split('"').nth(3) {
                    libraries.push(p.replace("\\\\", "/").into());
                }
            }
        }
    }
    libraries.into_iter().map(|l| l.join("steamapps/workshop/content/431960")).find(|p| p.is_dir()).map(|p| p.to_string_lossy().into_owned())
}


#[tauri::command]
fn scan_folder(dir: String, recursive: bool) -> Result<Vec<zwall_format::scan::Found>, String> {
    zwall_format::scan::scan(Path::new(&dir), recursive, 5000)
}


#[cfg(not(windows))]
fn install_icon() {
    const SIZES: &[(u32, &[u8])] = &[
        (32, include_bytes!("../icons/32x32.png")),
        (64, include_bytes!("../icons/64x64.png")),
        (128, include_bytes!("../icons/128x128.png")),
        (256, include_bytes!("../icons/128x128@2x.png")),
        (512, include_bytes!("../icons/icon.png")),
    ];
    let Some(base) = std::env::var_os("XDG_DATA_HOME").map(std::path::PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share"))) else { return };
    let theme = base.join("icons/hicolor");
    let mut changed = false;
    for (size, bytes) in SIZES {
        let path = theme.join(format!("{size}x{size}/apps/zwall.png"));
        if std::fs::read(&path).ok().as_deref() != Some(*bytes) {
            let _ = std::fs::create_dir_all(path.parent().unwrap());
            changed |= std::fs::write(&path, bytes).is_ok();
        }
    }
    if changed {

        let _ = std::fs::File::open(&theme).and_then(|f| f.set_modified(std::time::SystemTime::now()));
    }
}

pub fn open_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| open_window(app)))

        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![send, snapshot, wake_engine, classify, autostart, set_autostart, reveal, scan_folder, wallpaper_engine_folder, window_glass, quit_app, open_link])
        .setup(|app| {
            #[cfg(not(windows))]
            std::thread::spawn(install_icon);
            let link = Link::start(app.handle().clone());
            app.manage(link);
            tray::create(app.handle())?;
            if let Some(w) = app.get_webview_window(MAIN) {
                enable_window_glass(&w);
            }


            if let Some(w) = app.get_webview_window(MAIN) {
                let handle = app.handle().clone();
                let born = std::time::Instant::now();
                w.on_window_event(move |e| {
                    if born.elapsed() > std::time::Duration::from_millis(1500) && matches!(e, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
                        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                        let _ = handle.save_window_state(StateFlags::all());
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ZWall");
}

#[cfg(test)]
mod tests {
    use super::*;


    #[test]
    fn scans_a_real_workshop_folder() {
        let Ok(dir) = std::env::var("ZWALL_WE_DIR") else { return };
        let found = scan_folder(dir, true).unwrap();
        let ok = found.iter().filter(|f| f.skip.is_none()).count();
        println!("{} projects, {} importable", found.len(), ok);
        assert!(found.iter().all(|f| f.source == Some("wallpaper-engine")));
    }

    #[test]
    fn scans_wallpaper_engine_projects() {
        let root = std::env::temp_dir().join(format!("zwall-we-{}", std::process::id()));
        let mk = |id: &str, json: &str, file: Option<&str>| {
            let d = root.join(id);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("project.json"), json).unwrap();
            if let Some(f) = file {
                std::fs::write(d.join(f), b"x").unwrap();
            }
        };
        mk("111", "\u{feff}{\"title\":\"Rainy Tokyo\",\"type\":\"video\",\"file\":\"tokyo.mp4\",\"tags\":[\"Anime\",\"Rain\"]}", Some("tokyo.mp4"));

        mk("222", r#"{"title":"Clock","type":"web","file":"index.html"}"#, Some("index.html"));
        mk("333", r#"{"title":"Particles","type":"scene","file":"scene.json"}"#, None);
        let mut found = scan_folder(root.to_string_lossy().into_owned(), true).unwrap();
        found.sort_by(|a, b| a.name.cmp(&b.name));
        let _ = std::fs::remove_dir_all(&root);
        let summary: Vec<(String, &str, bool, Vec<String>)> = found.iter().map(|f| (f.name.clone(), f.kind, f.skip.is_some(), f.tags.clone())).collect();
        assert_eq!(
            summary,
            vec![
                ("Clock".into(), "web", false, vec![]),
                ("Particles".into(), "scene", true, vec![]),
                ("Rainy Tokyo".into(), "video", false, vec!["anime".into(), "rain".into()]),
            ]
        );
        assert!(found.iter().find(|f| f.name == "Rainy Tokyo").unwrap().path.ends_with("tokyo.mp4"));
    }
}
