

use crate::server::Hub;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};
use zwall_format::{Kind, Layer, Manifest, Param, FORMAT_VERSION};
use zwall_ipc::{LibraryItem, Motion, Overlay, Params, Tint};

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| "/tmp".into())
}

fn params_to_manifest(p: &Params) -> BTreeMap<String, Param> {
    BTreeMap::from([
        ("speed".into(), Param::Number(p.speed as f64)),
        ("intensity".into(), Param::Number(p.intensity as f64)),
        ("depth".into(), Param::Number(p.depth as f64)),
        ("volume".into(), Param::Number(p.volume as f64)),
        ("motion".into(), Param::Text(format!("{:?}", p.motion).to_lowercase())),
        ("tint".into(), Param::Text(format!("{:?}", p.tint).to_lowercase())),
        ("overlay".into(), Param::Text(format!("{:?}", p.overlay).to_lowercase())),
        ("overlay_amount".into(), Param::Number(p.overlay_amount as f64)),
        ("life".into(), Param::Number(p.life as f64)),
    ])
}

fn params_from_manifest(m: &BTreeMap<String, Param>) -> Params {
    let num = |k: &str, d: f32| match m.get(k) {
        Some(Param::Number(n)) => *n as f32,
        _ => d,
    };
    let text = |k: &str| match m.get(k) {
        Some(Param::Text(t)) => t.clone(),
        _ => String::new(),
    };
    Params {
        speed: num("speed", 1.0),
        intensity: num("intensity", 1.0),
        depth: num("depth", 1.0),
        volume: num("volume", 1.0),
        motion: match text("motion").as_str() {
            "drift" => Motion::Drift,
            "still" => Motion::Still,
            _ => Motion::Mouse,
        },
        tint: match text("tint").as_str() {
            "accent" => Tint::Accent,
            "mono" => Tint::Mono,
            _ => Tint::Original,
        },
        overlay: match text("overlay").as_str() {
            "rain" => Overlay::Rain,
            "snow" => Overlay::Snow,
            "fireflies" => Overlay::Fireflies,
            "grain" => Overlay::Grain,
            _ => Overlay::None,
        },
        overlay_amount: num("overlay_amount", 1.0),
        life: num("life", 1.0),
    }
}

fn safe_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' }).collect();
    let s = s.trim().to_string();
    if s.is_empty() { "wallpaper".into() } else { s }
}

pub fn export(hub: Arc<Hub>, path: String, display: Option<String>) {
    std::thread::spawn(move || {
        let s = hub.snapshot();
        let result = (|| -> anyhow::Result<PathBuf> {
            let name = display.or_else(|| s.library.iter().find(|i| i.path == path).map(|i| i.name.clone())).unwrap_or_else(|| {
                path.strip_prefix("preset://").map(String::from).unwrap_or_else(|| Path::new(&path).file_stem().map_or("wallpaper".into(), |s| s.to_string_lossy().into_owned()))
            });
            let params = params_to_manifest(&s.params.get(&path).copied().unwrap_or_default());
            let mut bundle: Vec<(String, Vec<u8>)> = Vec::new();
            let (kind, source, asset) = if path.starts_with("preset://") {
                (Kind::Shader, path.clone(), None)
            } else if zwall_render::is_web(&path) {

                let entry = PathBuf::from(zwall_render::web_entry(&path));
                let root = entry.parent().ok_or_else(|| anyhow::anyhow!("bad path"))?.to_path_buf();
                let mut total = 0u64;
                collect(&root, &root, &mut bundle, &mut total)?;
                let rel = entry.strip_prefix(&root)?.to_string_lossy().into_owned();
                (Kind::Web, format!("assets/{rel}"), None)
            } else {
                let file = Path::new(&path).file_name().ok_or_else(|| anyhow::anyhow!("bad path"))?.to_string_lossy().into_owned();
                let kind = if zwall_render::is_video(&path) { Kind::Video } else { Kind::Parallax };
                (kind, format!("assets/{file}"), Some(std::fs::read(&path)?))
            };


            let packed = match (&asset, kind) {
                (Some(bytes), Kind::Parallax) if is_jpeg(&path) => pack_jpeg(bytes, &format!("{source}.jxl")),
                _ => None,
            };
            let manifest = Manifest {
                format: FORMAT_VERSION,
                name: name.clone(),
                kind,
                author: std::env::var("USER").ok(),
                licence: None,
                tags: s.tags.get(&path).cloned().unwrap_or_default(),
                layers: vec![Layer { kind, source: source.clone(), packed: packed.as_ref().map(|(p, _)| p.clone()), params, audio_reactive: false }],
            };
            let dir = home().join("Pictures").join("ZWall");
            std::fs::create_dir_all(&dir)?;
            let out = dir.join(format!("{}.zwall", safe_name(&name)));
            let f = std::fs::File::create(&out)?;
            let mut assets: Vec<(&str, &[u8])> = match (&packed, &asset) {
                (Some((p, jxl)), _) => vec![(p.file.as_str(), jxl.as_slice())],
                (None, Some(a)) => vec![(source.as_str(), a.as_slice())],
                _ => Vec::new(),
            };
            assets.extend(bundle.iter().map(|(p, b)| (p.as_str(), b.as_slice())));
            zwall_format::write(f, &manifest, &assets)?;
            Ok(out)
        })();
        match result {
            Ok(out) => hub.notice(format!("Saved {}", out.display())),
            Err(e) => hub.notice_error(format!("Couldn't export: {e:#}")),
        }
    });
}

pub fn import(hub: Arc<Hub>, file: String) {
    std::thread::spawn(move || {
        let result = (|| -> anyhow::Result<String> {
            let mut zip = zip::ZipArchive::new(std::fs::File::open(&file)?)?;
            let manifest = zwall_format::read_manifest(std::fs::File::open(&file)?)?;
            let layer = manifest.layers.first().ok_or_else(|| anyhow::anyhow!("the file holds no wallpaper"))?;
            let params = params_from_manifest(&layer.params);
            let path = if layer.source.starts_with("preset://") {
                layer.source.clone()
            } else {

                let stem = safe_name(&manifest.name);
                let dir = crate::desktop::data_dir().join("library").join(format!("{stem}-{:08x}", crc(&file)));
                std::fs::create_dir_all(&dir)?;
                let dest = if layer.kind == Kind::Web {

                    for i in 0..zip.len() {
                        let mut f = zip.by_index(i)?;
                        let Some(rel) = f.enclosed_name() else { continue };
                        let Ok(rel) = rel.strip_prefix("assets") else { continue };
                        if f.is_dir() {
                            continue;
                        }
                        let out = dir.join(rel);
                        std::fs::create_dir_all(out.parent().unwrap())?;
                        std::io::copy(&mut f, &mut std::fs::File::create(&out)?)?;
                    }
                    dir.join(layer.source.strip_prefix("assets/").ok_or_else(|| anyhow::anyhow!("bad page path"))?)
                } else {
                    let asset_name = Path::new(&layer.source).file_name().ok_or_else(|| anyhow::anyhow!("bad asset path"))?;
                    let dest = dir.join(asset_name);

                    std::fs::write(&dest, zwall_format::read_asset(&mut zip, layer)?)?;
                    dest
                };
                let dest = dest.to_string_lossy().into_owned();
                let kind = if zwall_render::is_web(&dest) {
                    "web"
                } else if zwall_render::is_video(&dest) {
                    "video"
                } else {
                    "photo"
                };
                hub.request(zwall_ipc::Request::AddToLibrary(LibraryItem { path: dest.clone(), name: manifest.name.clone(), kind: kind.into(), added: 0, from_watch: None }));
                dest
            };
            if !manifest.tags.is_empty() {
                hub.request(zwall_ipc::Request::SetTags { path: path.clone(), tags: manifest.tags.clone() });
            }
            if params != Params::default() {
                hub.request(zwall_ipc::Request::SetParams { path: path.clone(), params });
            }
            Ok(manifest.name)
        })();
        match result {
            Ok(name) => hub.notice(format!("Imported {name}")),
            Err(e) => hub.notice_error(format!("Couldn't import {}: {e:#}", Path::new(&file).file_name().map_or(file.clone(), |f| f.to_string_lossy().into_owned()))),
        }
    });
}

fn is_jpeg(path: &str) -> bool {
    Path::new(path).extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"))
}


fn pack_jpeg(original: &[u8], file: &str) -> Option<(zwall_format::Packed, Vec<u8>)> {
    let dir = std::env::temp_dir().join(format!("zwall-pack-{}", std::process::id()));
    std::fs::create_dir_all(&dir).ok()?;
    let (src, dst) = (dir.join("in.jpg"), dir.join("out.jxl"));
    let result = (|| {
        std::fs::write(&src, original).ok()?;
        let ok = crate::desktop::command("cjxl").args(["--lossless_jpeg=1", "--quiet"]).arg(&src).arg(&dst).status().ok()?.success();
        let jxl = if ok { std::fs::read(&dst).ok()? } else { return None };
        let p = zwall_format::Packed { codec: "jxl-jpeg".into(), file: file.into(), size: original.len() as u64, crc32: crc32fast::hash(original) };
        let back = zwall_format::unpack(&p, &jxl).ok()?;
        (back == original && jxl.len() < original.len()).then_some((p, jxl))
    })();
    let _ = std::fs::remove_dir_all(&dir);
    if let Some((_, jxl)) = &result {
        log::info!("export: packed JPEG {} → {} bytes", original.len(), jxl.len());
    }
    result
}


fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>, total: &mut u64) -> anyhow::Result<()> {
    const MAX: u64 = 200 * 1024 * 1024;
    for e in std::fs::read_dir(dir)? {
        let p = e?.path();
        if p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
            continue;
        }
        if p.is_dir() {
            collect(root, &p, out, total)?;
        } else {
            *total += std::fs::metadata(&p)?.len();
            anyhow::ensure!(*total <= MAX, "the page's folder is over 200 MB; keep it to what the page needs");
            let rel = p.strip_prefix(root)?.to_string_lossy().replace('\\', "/");
            out.push((format!("assets/{rel}"), std::fs::read(&p)?));
        }
    }
    Ok(())
}

fn crc(path: &str) -> u32 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    std::fs::metadata(path).ok().map(|m| m.len()).hash(&mut h);
    h.finish() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn params_survive_the_manifest() {
        let p = Params { speed: 0.5, intensity: 1.25, depth: 0.0, motion: Motion::Drift, tint: Tint::Mono, volume: 0.3, overlay: Overlay::Snow, overlay_amount: 0.7, life: 0.4 };
        assert_eq!(params_from_manifest(&params_to_manifest(&p)), p);
    }

    #[test]
    fn jpegs_travel_packed_and_come_back_identical() {
        if crate::desktop::on_path("cjxl").is_none() {
            return;
        }

        let img = zwall_render::image::RgbImage::from_fn(320, 200, |x, y| zwall_render::image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8]));
        let mut jpeg = Vec::new();
        zwall_render::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90).encode_image(&img).unwrap();
        let (packed, jxl) = pack_jpeg(&jpeg, "assets/p.jpg.jxl").expect("packs");
        assert!(jxl.len() < jpeg.len());
        let layer = Layer { kind: Kind::Parallax, source: "assets/p.jpg".into(), packed: Some(packed), params: BTreeMap::new(), audio_reactive: false };
        let manifest = Manifest { format: FORMAT_VERSION, name: "p".into(), kind: Kind::Parallax, author: None, licence: None, tags: vec![], layers: vec![layer] };
        let mut buf = std::io::Cursor::new(Vec::new());
        zwall_format::write(&mut buf, &manifest, &[("assets/p.jpg.jxl", &jxl)]).unwrap();
        buf.set_position(0);
        let read = zwall_format::read_manifest(&mut buf).unwrap();
        assert_eq!(read.format, 2);
        buf.set_position(0);
        let mut zip = zip::ZipArchive::new(buf).unwrap();
        assert_eq!(zwall_format::read_asset(&mut zip, &read.layers[0]).unwrap(), jpeg);
    }
}
