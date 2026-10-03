

use raw_window_handle::{RawDisplayHandle, RawWindowHandle};
use zwall_ipc::Monitor;

#[cfg(target_os = "linux")]
pub mod gnome;
#[cfg(target_os = "linux")]
pub mod hyprland;
#[cfg(target_os = "linux")]
pub mod kwin;
#[cfg(target_os = "linux")]
pub mod layershell;
#[cfg(windows)]
pub mod windows;
#[cfg(target_os = "linux")]
pub mod x11;


pub struct SurfaceHandles {
    pub display: RawDisplayHandle,
    pub window: RawWindowHandle,

    pub native: u64,
}


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hotkey {
    Pause,
    Mute,
    Next,
}


#[derive(Debug, Default)]
pub struct Input {

    pub clicks: Vec<(i32, i32)>,
    pub hotkeys: Vec<Hotkey>,
}

#[derive(Debug, Clone, Copy)]
pub struct Pointer {
    pub x: i32,
    pub y: i32,
}

pub trait Backend {

    fn name(&self) -> &'static str;

    fn monitors(&mut self) -> anyhow::Result<Vec<Monitor>>;


    fn create_surface(&mut self, key: &str, rect: Rect) -> anyhow::Result<SurfaceHandles>;


    fn create_overlay(&mut self, key: &str, _rect: Rect) -> anyhow::Result<SurfaceHandles> {
        anyhow::bail!("{key}: full-screen overlays aren't supported here")
    }

    fn destroy_surface(&mut self, key: &str);
    fn pointer(&self) -> Option<Pointer> {
        None
    }


    fn pump(&mut self) -> Input {
        Input::default()
    }

    fn set_hotkeys(&mut self, _on: bool) -> Vec<String> {
        Vec::new()
    }

    fn idle_ms(&self) -> u64 {
        0
    }


    fn covered(&self, _rect: Rect) -> Option<f32> {
        None
    }

    fn fullscreen_active(&self) -> bool {
        false
    }


    fn surfaces_lost(&mut self) -> bool {
        false
    }
}


pub fn detect() -> anyhow::Result<Box<dyn Backend>> {
    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        let is = |name: &str| desktop.split(':').any(|d| d.eq_ignore_ascii_case(name));

        match std::env::var("ZWALL_BACKEND").as_deref() {
            Ok("kwin") => return Ok(Box::new(kwin::KWin::connect()?)),
            Ok("x11") => return Ok(Box::new(x11::X11::connect()?)),
            Ok("layershell") => return Ok(Box::new(layershell::LayerShell::connect()?)),
            _ => {}
        }
        if std::env::var_os("WAYLAND_DISPLAY").is_some() && is("kde") {
            return Ok(Box::new(kwin::KWin::connect()?));
        }


        if is("gnome") && std::env::var_os("DISPLAY").is_some() {
            return Ok(Box::new(x11::X11::connect()?));
        }
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {

            if desktop.split(':').any(|d| d.eq_ignore_ascii_case("gnome")) {
                return Ok(Box::new(gnome::Gnome));
            }
            return Ok(Box::new(layershell::LayerShell::connect()?));
        }
        if std::env::var_os("DISPLAY").is_some() {
            return Ok(Box::new(x11::X11::connect()?));
        }
        anyhow::bail!("no Wayland or X11 display found");
    }
    #[cfg(windows)]
    {
        Ok(Box::new(windows::WorkerW::connect()?))
    }
}
