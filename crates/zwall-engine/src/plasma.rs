

use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, process::Command};

pub const PLUGIN: &str = "eu.zsync.zwall";


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Original {
    pub plugin: String,

    pub config: BTreeMap<String, String>,
}


const FILES: &[(&str, &[u8])] = include!(concat!(env!("OUT_DIR"), "/plugin_files.rs"));


pub fn available() -> bool {
    let kde = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().split(':').any(|d| d.eq_ignore_ascii_case("kde"));
    kde && script("print('ok')").is_ok_and(|o| o.trim() == "ok")
}

fn script(js: &str) -> anyhow::Result<String> {
    let out = Command::new("qdbus6")
        .args(["org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript", js])
        .output()
        .or_else(|_| Command::new("qdbus").args(["org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript", js]).output())?;
    anyhow::ensure!(out.status.success(), "plasmashell script failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}


pub fn install() -> anyhow::Result<bool> {
    let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share"))).ok_or_else(|| anyhow::anyhow!("no data dir"))?;
    let dir = base.join("plasma/wallpapers").join(PLUGIN);
    let mut changed = false;
    for (rel, bytes) in FILES {
        let path = dir.join(rel);
        if std::fs::read(&path).ok().as_deref() != Some(*bytes) {
            std::fs::create_dir_all(path.parent().unwrap())?;
            std::fs::write(&path, bytes)?;
            changed = true;
        }
    }
    if changed {
        log::info!("plasma: installed wallpaper plugin to {}", dir.display());
    }
    Ok(changed)
}


fn on_screen(x: i32, y: i32, w: u32, h: u32, body: &str) -> anyhow::Result<String> {
    script(&format!(
        "desktops().forEach(function(d){{ var g = screenGeometry(d.screen); if (g.x=={x} && g.y=={y} && g.width=={w} && g.height=={h}) {{ {body} }} }});"
    ))
}


pub fn take(x: i32, y: i32, w: u32, h: u32) -> anyhow::Result<Option<Original>> {
    let read = on_screen(
        x,
        y,
        w,
        h,
        "d.currentConfigGroup = ['Wallpaper', d.wallpaperPlugin, 'General']; var c = {}; d.configKeys.forEach(function(k){ c[k] = String(d.readConfig(k)); }); print(JSON.stringify({plugin: d.wallpaperPlugin, config: c}));",
    )?;
    let original: Original = serde_json::from_str(read.trim()).map_err(|e| anyhow::anyhow!("no Plasma desktop at {x},{y} {w}x{h} ({e})"))?;
    if original.plugin == PLUGIN {
        return Ok(None);
    }
    on_screen(x, y, w, h, &format!("d.wallpaperPlugin = '{PLUGIN}';"))?;
    log::info!("plasma: screen at {x},{y} now shows ZWall (was {})", original.plugin);
    Ok(Some(original))
}


pub fn give_back(x: i32, y: i32, w: u32, h: u32, original: &Original) -> anyhow::Result<()> {
    let config = serde_json::to_string(&original.config)?;
    let plugin = serde_json::to_string(&original.plugin)?;
    on_screen(
        x,
        y,
        w,
        h,

        &format!("if (d.wallpaperPlugin == '{PLUGIN}') {{ d.wallpaperPlugin = {plugin}; d.currentConfigGroup = ['Wallpaper', {plugin}, 'General']; var c = {config}; Object.keys(c).forEach(function(k){{ d.writeConfig(k, c[k]); }}); }}"),
    )?;
    log::info!("plasma: screen at {x},{y} back to {}", original.plugin);
    Ok(())
}
