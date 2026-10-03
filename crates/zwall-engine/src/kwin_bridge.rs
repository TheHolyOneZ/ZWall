

use crate::backend::Rect;
use std::{process::Command, sync::Mutex, time::Duration};

static SEE_THROUGH: Mutex<Vec<Rect>> = Mutex::new(Vec::new());

const SCRIPT: &str = r#"
function report() {
    var parts = [];
    workspace.windowList().forEach(function (w) {
        if (w.normalWindow && !w.minimized && w.opacity < 0.97) {
            var g = w.frameGeometry;
            parts.push([Math.round(g.x), Math.round(g.y), Math.round(g.width), Math.round(g.height)].join(","));
        }
    });
    callDBus("eu.zsync.ZWall", "/eu/zsync/ZWall", "eu.zsync.ZWall", "Translucent", parts.join(";"));
}
function watch(w) {
    w.opacityChanged.connect(report);
    w.frameGeometryChanged.connect(report);
    w.minimizedChanged.connect(report);
}
workspace.windowList().forEach(watch);
workspace.windowAdded.connect(function (w) { watch(w); report(); });
workspace.windowRemoved.connect(report);
report();
"#;

struct Bridge;

#[zbus::interface(name = "eu.zsync.ZWall")]
impl Bridge {

    fn translucent(&self, rects: String) {
        let parsed: Vec<Rect> = rects
            .split(';')
            .filter_map(|r| {
                let v: Vec<i64> = r.split(',').filter_map(|n| n.trim().parse().ok()).collect();
                (v.len() == 4).then(|| Rect { x: v[0] as i32, y: v[1] as i32, w: v[2].max(0) as u32, h: v[3].max(0) as u32 })
            })
            .collect();
        *SEE_THROUGH.lock().unwrap() = parsed;
    }
}


pub fn see_through(r: Rect) -> bool {
    const SLACK: i32 = 64;
    SEE_THROUGH.lock().unwrap().iter().any(|f| r.x >= f.x - SLACK && r.y >= f.y - SLACK && r.x + r.w as i32 <= f.x + f.w as i32 + SLACK && r.y + r.h as i32 <= f.y + f.h as i32 + SLACK)
}


pub fn start() {
    std::thread::Builder::new()
        .name("zwall-kwin".into())
        .spawn(|| {
            let conn = match zbus::blocking::connection::Builder::session()
                .and_then(|b| b.name("eu.zsync.ZWall"))
                .and_then(|b| b.serve_at("/eu/zsync/ZWall", Bridge))
                .and_then(|b| b.build())
            {
                Ok(c) => c,
                Err(e) => return log::warn!("kwin bridge: {e}"),
            };
            if let Err(e) = load_script() {
                log::warn!("kwin bridge: {e:#}");
            }

            let _conn = conn;
            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        })
        .ok();
}

fn load_script() -> anyhow::Result<()> {
    let dir = crate::desktop::cache_dir().ok_or_else(|| anyhow::anyhow!("no cache dir"))?;
    std::fs::create_dir_all(&dir)?;
    let file = dir.join("kwin-bridge.js");
    std::fs::write(&file, SCRIPT)?;
    let q = |args: &[&str]| Command::new("qdbus6").args(["org.kde.KWin", "/Scripting"]).args(args).output();
    let _ = q(&["org.kde.kwin.Scripting.unloadScript", "zwall-bridge"]);
    let out = q(&["org.kde.kwin.Scripting.loadScript", &file.to_string_lossy(), "zwall-bridge"])?;
    let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
    anyhow::ensure!(id.parse::<i64>().is_ok_and(|n| n >= 0), "KWin refused the script ({id})");
    Command::new("qdbus6").args(["org.kde.KWin", &format!("/Scripting/Script{id}"), "org.kde.kwin.Script.run"]).output()?;
    log::info!("kwin bridge: watching window translucency");
    Ok(())
}
