

use std::path::Path;


#[derive(Debug, Clone, serde::Serialize)]
pub struct Found {
    pub path: String,

    pub name: String,
    pub kind: &'static str,

    pub folder: String,
    pub bytes: u64,

    pub tags: Vec<String>,

    pub skip: Option<String>,

    pub source: Option<&'static str>,
}


pub fn wallpaper_engine(dir: &Path, folder: String) -> Option<Found> {

    let text = std::fs::read_to_string(dir.join("project.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let title = json["title"].as_str().filter(|t| !t.trim().is_empty()).map(String::from).unwrap_or_else(|| dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let tags = json["tags"].as_array().into_iter().flatten().filter_map(|t| t.as_str()).map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect();
    let ty = json["type"].as_str().unwrap_or("").to_ascii_lowercase();
    let file = json["file"].as_str().map(|f| dir.join(f));
    let (kind, path, skip) = match (ty.as_str(), file) {
        ("video", Some(f)) if f.is_file() => ("video", f, None),
        ("web", Some(f)) if f.is_file() => ("web", f, None),
        ("scene", _) => ("scene", dir.to_path_buf(), Some("Scene wallpapers need Wallpaper Engine's own renderer")),
        ("application", _) => ("scene", dir.to_path_buf(), Some("Application wallpapers only run on Windows")),
        _ => ("scene", dir.to_path_buf(), Some("Its file is missing or of an unknown type")),
    };
    let bytes = if path.is_file() { path.metadata().map(|m| m.len()).unwrap_or(0) } else { 0 };
    Some(Found { path: path.to_string_lossy().into_owned(), name: title, kind, folder, bytes, tags, skip: skip.map(String::from), source: Some("wallpaper-engine") })
}

pub fn kind_of(p: &Path) -> Option<&'static str> {
    if p.is_dir() {
        return p.join("index.html").is_file().then_some("web");
    }
    match p.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "avif" => Some("photo"),
        "mp4" | "webm" | "mkv" | "mov" | "gif" => Some("video"),
        "html" | "htm" => Some("web"),
        "zwall" => Some("zwall"),
        _ => None,
    }
}


pub fn scan(root: &Path, recursive: bool, max: usize) -> Result<Vec<Found>, String> {
    if !root.is_dir() {
        return Err(format!("{} isn't a folder", root.display()));
    }
    let mut out = Vec::new();
    if root.join("project.json").is_file() {
        return Ok(wallpaper_engine(root, String::new()).into_iter().collect());
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        entries.sort();
        for p in entries {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if name.starts_with('.') || name == "node_modules" || name == "__MACOSX" {
                continue;
            }
            let folder = p.parent().and_then(|x| x.strip_prefix(root).ok()).map(|x| x.to_string_lossy().into_owned()).unwrap_or_default();
            if p.is_dir() && p.join("project.json").is_file() {
                if let Some(f) = wallpaper_engine(&p, folder) {
                    out.push(f);
                }
                continue;
            }
            if let Some(kind) = kind_of(&p) {

                if kind == "web" && p.is_file() && d != root && d.join("index.html").is_file() {
                    continue;
                }
                let bytes = if p.is_dir() { 0 } else { p.metadata().map(|m| m.len()).unwrap_or(0) };
                let stem = if p.is_dir() { name.clone() } else { p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(name.clone()) };
                out.push(Found { path: p.to_string_lossy().into_owned(), name: stem, kind, folder, bytes, tags: Vec::new(), skip: None, source: None });
                if out.len() >= max {
                    return Ok(out);
                }
            } else if p.is_dir() && recursive {
                stack.push(p);
            }
        }
    }
    Ok(out)
}

