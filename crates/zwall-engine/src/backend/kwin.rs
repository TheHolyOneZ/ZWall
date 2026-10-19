use super::{Backend, Pointer, Rect, SurfaceHandles};
use std::process::Command;
use zwall_ipc::Monitor;

pub struct KWin;

impl KWin {
    pub fn connect() -> anyhow::Result<Self> {
        anyhow::ensure!(Command::new("kscreen-doctor").arg("-j").output().is_ok_and(|o| o.status.success()), "kscreen-doctor is needed on Plasma Wayland");
        Ok(Self)
    }
}

pub fn parse_outputs(json: &str) -> anyhow::Result<Vec<Monitor>> {
    let v: serde_json::Value = serde_json::from_str(json)?;
    let mut out = Vec::new();
    for o in v["outputs"].as_array().into_iter().flatten().filter(|o| o["enabled"].as_bool() == Some(true)) {
        let scale = o["scale"].as_f64().unwrap_or(1.0).max(0.1);
        let mode = o["modes"].as_array().into_iter().flatten().find(|m| m["id"] == o["currentModeId"]);
        let size = mode.map(|m| &m["size"]).unwrap_or(&o["size"]);
        let (w, h) = (size["width"].as_f64().unwrap_or(0.0), size["height"].as_f64().unwrap_or(0.0));
        out.push(Monitor {
            name: o["name"].as_str().unwrap_or("?").to_string(),
            x: o["pos"]["x"].as_i64().unwrap_or(0) as i32,
            y: o["pos"]["y"].as_i64().unwrap_or(0) as i32,
            width: (w / scale).round() as u32,
            height: (h / scale).round() as u32,
            scale,
            primary: o["priority"].as_u64() == Some(1),
            wallpaper: None,
            span: None,
        });
    }
    Ok(out)
}

impl Backend for KWin {
    fn name(&self) -> &'static str {
        "kwin"
    }

    fn monitors(&mut self) -> anyhow::Result<Vec<Monitor>> {
        let o = Command::new("kscreen-doctor").arg("-j").output()?;
        parse_outputs(&String::from_utf8_lossy(&o.stdout))
    }

    fn create_surface(&mut self, key: &str, _rect: Rect) -> anyhow::Result<SurfaceHandles> {
        anyhow::bail!("{key}: on Plasma Wayland the wallpaper is drawn by Plasma itself")
    }

    fn destroy_surface(&mut self, _key: &str) {}

    fn pointer(&self) -> Option<Pointer> {
        crate::kwin_bridge::pointer().map(|(x, y)| Pointer { x, y })
    }

    fn idle_ms(&self) -> u64 {
        Command::new("qdbus6")
            .args(["org.freedesktop.ScreenSaver", "/ScreenSaver", "org.freedesktop.ScreenSaver.GetSessionIdleTime"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_outputs_are_logical() {
        let json = r#"{"outputs":[
            {"name":"eDP-1","enabled":true,"pos":{"x":0,"y":0},"scale":2,"priority":1,"currentModeId":"1","modes":[{"id":"1","size":{"width":2880,"height":1800}}]},
            {"name":"HDMI-A-1","enabled":false,"pos":{"x":0,"y":0},"scale":1,"priority":2,"currentModeId":"1","modes":[]}
        ]}"#;
        let m = parse_outputs(json).unwrap();
        assert_eq!(m.len(), 1);
        assert_eq!((m[0].width, m[0].height, m[0].primary), (1440, 900, true));
    }
}
