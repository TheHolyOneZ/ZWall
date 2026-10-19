use crate::link::Link;
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};
use zwall_ipc::{PauseReason, Request, State};

const ID: &str = "zwall";
static ICON: &[u8] = include_bytes!("../icons/32x32.png");

#[derive(PartialEq, Clone)]
struct Key {
    connected: bool,
    paused: PauseReason,
    muted: bool,
    gpu: Option<i32>,

    plasma: bool,
}

static LAST: Mutex<Option<Key>> = Mutex::new(None);

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(ID)
        .icon(Image::from_bytes(ICON)?)
        .tooltip("ZWall")
        .menu(&menu(app, None)?)
        .on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()))
        .build(app)?;
    Ok(())
}

fn menu(app: &AppHandle, k: Option<&Key>) -> tauri::Result<Menu<Wry>> {
    let m = Menu::new(app)?;
    match k.filter(|k| k.connected) {
        None => m.append(&MenuItem::with_id(app, "wake", "Start wallpaper engine", true, None::<&str>)?)?,
        Some(k) => {
            let label = match k.paused {
                PauseReason::None | PauseReason::User => "Paused",
                PauseReason::Fullscreen => "Paused · fullscreen app",
                PauseReason::Covered => "Paused · desktop covered",
                PauseReason::Battery => "Paused · on battery",
                PauseReason::App => "Paused · app running",
                PauseReason::Idle => "Paused · you're away",
                PauseReason::Locked => "Paused · screen locked",
            };
            m.append(&CheckMenuItem::with_id(app, "pause", label, true, k.paused != PauseReason::None, None::<&str>)?)?;
            m.append(&CheckMenuItem::with_id(app, "mute", "Mute video sound", true, k.muted, None::<&str>)?)?;
            m.append(&MenuItem::with_id(app, "next", "Next wallpaper", true, None::<&str>)?)?;
            if let Some(g) = k.gpu {
                let what = if k.plasma { "Plasma desktop GPU" } else { "Wallpaper GPU" };
                m.append(&MenuItem::with_id(app, "gpu", format!("{what}: {g}%"), false, None::<&str>)?)?;
            }
        }
    }
    m.append(&PredefinedMenuItem::separator(app)?)?;
    m.append(&MenuItem::with_id(app, "open", "Open ZWall…", true, None::<&str>)?)?;
    m.append(&MenuItem::with_id(app, "quit", "Close app (wallpapers keep playing)", true, None::<&str>)?)?;
    m.append(&MenuItem::with_id(app, "quit_all", "Quit ZWall completely", true, None::<&str>)?)?;
    Ok(m)
}

pub fn update(app: &AppHandle, s: Option<&State>) {
    let k = Key { connected: s.is_some(), paused: s.map_or(PauseReason::None, |s| s.paused), muted: s.is_none_or(|s| s.settings.mute), gpu: s.and_then(|s| s.gpu_percent).map(|g| g.round() as i32), plasma: s.is_some_and(|s| s.backend == "plasma") };
    {
        let mut last = LAST.lock().unwrap();
        if last.as_ref() == Some(&k) {
            return;
        }
        *last = Some(k.clone());
    }
    let app2 = app.clone();

    let _ = app.run_on_main_thread(move || {
        let Some(tray) = app2.tray_by_id(ID) else { return };
        let _ = tray.set_tooltip(Some(if k.connected { "ZWall" } else { "ZWall · engine not running" }));
        if let Ok(m) = menu(&app2, Some(&k)) {
            let _ = tray.set_menu(Some(m));
        }
    });
}

fn on_menu(app: &AppHandle, id: &str) {
    let link = app.try_state::<Arc<Link>>();
    let send = |r: Request| {
        if let Some(l) = &link {
            let _ = l.send(&r);
        }
    };
    match id {
        "pause" => {
            let paused = link.as_ref().and_then(|l| l.state()).is_some_and(|s| s.paused != PauseReason::None);
            send(if paused { Request::Resume } else { Request::Pause });
        }
        "next" => send(Request::Next),
        "mute" => {
            if let Some(mut settings) = link.as_ref().and_then(|l| l.state()).map(|s| s.settings) {
                settings.mute = !settings.mute;
                send(Request::SetSettings(settings));
            }
        }
        "open" => crate::open_window(app),
        "wake" => {
            if let Err(e) = crate::wake_engine_now(app) {
                use tauri::Emitter;
                let _ = app.emit("zwall://error", e);
            }
        }
        "quit" => app.exit(0),

        "quit_all" => {
            send(Request::Quit);
            std::thread::sleep(std::time::Duration::from_millis(300));
            app.exit(0);
        }
        _ => {}
    }

    *LAST.lock().unwrap() = None;
    if let Some(l) = &link {
        update(app, l.state().as_ref());
    }
}
