

use super::{Backend, Rect, SurfaceHandles};
use zwall_ipc::Monitor;

pub struct Gnome;

impl Backend for Gnome {
    fn name(&self) -> &'static str {
        "gnome"
    }

    fn monitors(&mut self) -> anyhow::Result<Vec<Monitor>> {
        Ok(Vec::new())
    }

    fn create_surface(&mut self, key: &str, _rect: Rect) -> anyhow::Result<SurfaceHandles> {
        anyhow::bail!("gnome: wallpaper surfaces for {key} are not implemented yet")
    }

    fn destroy_surface(&mut self, _monitor: &str) {}
}
