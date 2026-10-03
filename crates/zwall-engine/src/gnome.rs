

use std::{path::PathBuf, process::Command};

const UUID: &str = "zwall@zsync.eu";
const FILES: &[(&str, &[u8])] = &[
    ("metadata.json", include_bytes!("../../../gnome-extension/metadata.json")),
    ("extension.js", include_bytes!("../../../gnome-extension/extension.js")),
];

pub fn is_gnome() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().split(':').any(|d| d.eq_ignore_ascii_case("gnome"))
}


pub fn install() -> anyhow::Result<()> {
    let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share"))).ok_or_else(|| anyhow::anyhow!("no data dir"))?;
    let dir = base.join("gnome-shell/extensions").join(UUID);
    let mut changed = false;
    for (rel, bytes) in FILES {
        let path = dir.join(rel);
        if std::fs::read(&path).ok().as_deref() != Some(*bytes) {
            std::fs::create_dir_all(&dir)?;
            std::fs::write(&path, bytes)?;
            changed = true;
        }
    }
    let enabled = Command::new("gnome-extensions").args(["enable", UUID]).status().is_ok_and(|s| s.success());
    if changed {


        log::info!("gnome: installed the ZWall extension; it becomes active after your next login");
    }
    if !enabled {
        log::warn!("gnome: couldn't enable {UUID}; enable it in the Extensions app");
    }
    Ok(())
}
