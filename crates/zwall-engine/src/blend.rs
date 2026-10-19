use crate::server::Hub;
use std::{
    collections::BTreeMap,
    hash::{Hash, Hasher},
    sync::{Arc, Mutex},
};
use zwall_ipc::{BlendEdge, BlendLink, Monitor, State};
use zwall_render::image::{self, imageops::FilterType, Rgba, RgbaImage};

const N: usize = 256;

const DEPTH: u32 = 64;

static LAST: Mutex<Option<String>> = Mutex::new(None);
static BUSY: Mutex<bool> = Mutex::new(false);

struct Rect {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

fn rect(s: &State, m: &Monitor) -> Rect {
    let (x, y) = s.desk(m);
    Rect { x: x as f32, y: y as f32, w: m.width as f32, h: m.height as f32 }
}

pub fn pairs(s: &State) -> Vec<BlendLink> {
    let mut out = Vec::new();
    for a in &s.monitors {
        for b in &s.monitors {
            if a.name == b.name || (a.span.is_some() && a.span == b.span) {
                continue;
            }
            let (ra, rb) = (rect(s, a), rect(s, b));
            let tol = |len: f32| (len * 0.05).max(64.0);

            let side = ((ra.x + ra.w) - rb.x).abs() <= tol(ra.w.min(rb.w));
            let v0 = ra.y.max(rb.y);
            let v1 = (ra.y + ra.h).min(rb.y + rb.h);

            let stack = ((ra.y + ra.h) - rb.y).abs() <= tol(ra.h.min(rb.h));
            let h0 = ra.x.max(rb.x);
            let h1 = (ra.x + ra.w).min(rb.x + rb.w);
            let (stacked, lo, hi) = if side && v1 > v0 && ra.x < rb.x {
                (false, v0, v1)
            } else if stack && h1 > h0 && ra.y < rb.y && !side {
                (true, h0, h1)
            } else {
                continue;
            };
            let key = BlendLink::key(&a.name, &b.name);
            if let Some(l) = s.blend_links.get(&key) {
                out.push(BlendLink { stacked, ..l.clone() });
                continue;
            }
            let (pa, la, pb, lb) = if stacked { (ra.x, ra.w, rb.x, rb.w) } else { (ra.y, ra.h, rb.y, rb.h) };
            out.push(BlendLink {
                a: a.name.clone(),
                b: b.name.clone(),
                stacked,
                enabled: s.settings.blend_edges,
                into_a: s.settings.blend_width,
                into_b: s.settings.blend_width,
                a_span: [((lo - pa) / la).clamp(0.0, 1.0), ((hi - pa) / la).clamp(0.0, 1.0)],
                b_span: [((lo - pb) / lb).clamp(0.0, 1.0), ((hi - pb) / lb).clamp(0.0, 1.0)],
                strength: s.settings.blend_strength,
            });
        }
    }
    out
}

fn picture(s: &State, path: &str) -> Option<String> {
    s.thumbs.get(path).cloned().or_else(|| (!path.starts_with("preset://") && !zwall_render::is_video(path) && !zwall_render::is_web(path)).then(|| path.to_string()))
}

fn profile(img: &image::RgbImage, w: f32, h: f32, side: &str) -> Vec<[f32; 3]> {
    let (iw, ih) = (img.width() as f32, img.height() as f32);

    let scale = (w / iw).max(h / ih);
    let (cw, ch) = (w / scale, h / scale);
    let (cx, cy) = ((iw - cw) / 2.0, (ih - ch) / 2.0);
    let band = 0.06;
    let mut out = vec![[0.0f32; 3]; N];
    for (i, px) in out.iter_mut().enumerate() {
        let t0 = i as f32 / N as f32;
        let t1 = (i + 1) as f32 / N as f32;
        let (x0, x1, y0, y1) = match side {
            "left" => (cx, cx + cw * band, cy + ch * t0, cy + ch * t1),
            "right" => (cx + cw * (1.0 - band), cx + cw, cy + ch * t0, cy + ch * t1),
            "top" => (cx + cw * t0, cx + cw * t1, cy, cy + ch * band),
            _ => (cx + cw * t0, cx + cw * t1, cy + ch * (1.0 - band), cy + ch),
        };
        let (mut sum, mut n) = ([0.0f32; 3], 0.0f32);
        let xs = (x0.floor() as u32).min(img.width() - 1)..=(x1.ceil() as u32).clamp(1, img.width()) - 1;
        let ys = (y0.floor() as u32).min(img.height() - 1)..=(y1.ceil() as u32).clamp(1, img.height()) - 1;
        for y in ys {
            for x in xs.clone() {
                let p = img.get_pixel(x, y).0;
                for c in 0..3 {
                    sum[c] += p[c] as f32;
                }
                n += 1.0;
            }
        }
        *px = sum.map(|v| v / n.max(1.0));
    }

    for _ in 0..2 {
        let r = N / 20;
        let prev = out.clone();
        for (i, px) in out.iter_mut().enumerate() {
            let (a, b) = (i.saturating_sub(r), (i + r).min(N - 1));
            let mut sum = [0.0f32; 3];
            for p in &prev[a..=b] {
                for c in 0..3 {
                    sum[c] += p[c];
                }
            }
            *px = sum.map(|v| v / (b - a + 1) as f32);
        }
    }
    out
}

fn sample(p: &[[f32; 3]], t: f32) -> [f32; 3] {
    let f = (t.clamp(0.0, 1.0) * (N - 1) as f32).clamp(0.0, (N - 1) as f32);
    let (i, k) = (f.floor() as usize, f.fract());
    let j = (i + 1).min(N - 1);
    [0, 1, 2].map(|c| p[i][c] * (1.0 - k) + p[j][c] * k)
}

fn band(own: &[[f32; 3]], other: &[[f32; 3]], span: [f32; 2], other_span: [f32; 2], strength: f32, along_x: bool, seam_last: bool) -> RgbaImage {
    let (w, h) = if along_x { (N as u32, DEPTH) } else { (DEPTH, N as u32) };
    let len = (span[1] - span[0]).max(1e-3);
    RgbaImage::from_fn(w, h, |x, y| {
        let (i, d) = if along_x { (x, y) } else { (y, x) };
        let t = (i as f32 + 0.5) / N as f32;
        let u = (t - span[0]) / len;
        if !(0.0..=1.0).contains(&u) {
            return Rgba([0, 0, 0, 0]);
        }

        let ends = (u.min(1.0 - u) / 0.06).clamp(0.0, 1.0);
        let tb = other_span[0] + u * (other_span[1] - other_span[0]);
        let mine = sample(own, t);
        let theirs = sample(other, tb);
        let c = [0, 1, 2].map(|k| ((mine[k] + theirs[k]) / 2.0).round().clamp(0.0, 255.0) as u8);

        let mut s = (d as f32 + 0.5) / DEPTH as f32;
        if !seam_last {
            s = 1.0 - s;
        }
        let fall = s * s * (3.0 - 2.0 * s);
        let a = (fall.powf(1.4) * strength.clamp(0.0, 1.0) * ends * 255.0).round() as u8;
        Rgba([c[0], c[1], c[2], a])
    })
}

fn key(s: &State) -> String {
    let screens: Vec<_> = s.monitors.iter().map(|m| (&m.name, &m.wallpaper, &m.span, s.desk(m), m.width, m.height, m.wallpaper.as_ref().and_then(|p| s.thumbs.get(p)))).collect();
    format!("{screens:?}{:?}{}{}{}", s.blend_links, s.settings.blend_edges, s.settings.blend_strength, s.settings.blend_width)
}

pub fn tick(hub: &Arc<Hub>) {
    let s = hub.snapshot();
    let k = key(&s);
    {
        let mut last = LAST.lock().unwrap();
        if last.as_deref() == Some(k.as_str()) {
            return;
        }
        let mut busy = BUSY.lock().unwrap();
        if *busy {
            return;
        }
        *busy = true;
        *last = Some(k);
    }
    let pairs = pairs(&s);
    hub.set_blend_pairs(pairs.clone());
    let hub = hub.clone();
    std::thread::spawn(move || {
        let blends = make(&s, &pairs);
        hub.set_blends(blends);
        *BUSY.lock().unwrap() = false;
    });
}

fn make(s: &State, pairs: &[BlendLink]) -> BTreeMap<String, Vec<BlendEdge>> {
    let mut out: BTreeMap<String, Vec<BlendEdge>> = BTreeMap::new();
    let Some(dir) = crate::desktop::cache_dir().map(|d| d.join("blends")) else { return out };
    let _ = std::fs::create_dir_all(&dir);
    let mut pictures: BTreeMap<String, image::RgbImage> = BTreeMap::new();
    let mut load = |path: &str| -> Option<image::RgbImage> {
        if let Some(i) = pictures.get(path) {
            return Some(i.clone());
        }
        let file = picture(s, path)?;
        let img = image::open(&file).ok()?.resize(512, 512, FilterType::Triangle).to_rgb8();
        pictures.insert(path.to_string(), img.clone());
        Some(img)
    };
    for l in pairs.iter().filter(|l| l.enabled && l.strength > 0.0) {
        let (Some(ma), Some(mb)) = (s.monitors.iter().find(|m| m.name == l.a), s.monitors.iter().find(|m| m.name == l.b)) else { continue };
        let (Some(wa), Some(wb)) = (ma.wallpaper.as_deref(), mb.wallpaper.as_deref()) else { continue };
        let (Some(ia), Some(ib)) = (load(wa), load(wb)) else { continue };
        let (side_a, side_b) = if l.stacked { ("bottom", "top") } else { ("right", "left") };
        let pa = profile(&ia, ma.width as f32, ma.height as f32, side_a);
        let pb = profile(&ib, mb.width as f32, mb.height as f32, side_b);
        let img_a = band(&pa, &pb, l.a_span, l.b_span, l.strength, l.stacked, true);
        let img_b = band(&pb, &pa, l.b_span, l.a_span, l.strength, l.stacked, false);
        for (name, side, img, size) in [(&l.a, side_a, img_a, l.into_a), (&l.b, side_b, img_b, l.into_b)] {
            if size <= 0.0 {
                continue;
            }
            let mut h = std::collections::hash_map::DefaultHasher::new();
            (wa, wb, side, format!("{l:?}"), ma.width, ma.height, mb.width, mb.height).hash(&mut h);
            let file = dir.join(format!("{:016x}-{side}.png", h.finish()));
            if !file.exists() && img.save(&file).is_err() {
                continue;
            }
            out.entry(name.clone()).or_default().push(BlendEdge { side: side.into(), image: file.to_string_lossy().into_owned(), size: size.clamp(0.0, 0.5) });
        }
    }

    if let Ok(entries) = std::fs::read_dir(&dir) {
        let keep: Vec<&str> = out.values().flatten().map(|e| e.image.as_str()).collect();
        for e in entries.flatten() {
            let p = e.path();
            if !keep.contains(&p.to_string_lossy().as_ref()) && p.extension().is_some_and(|x| x == "png") {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(name: &str, x: i32, y: i32, w: u32, h: u32) -> Monitor {
        Monitor { name: name.into(), x, y, width: w, height: h, scale: 1.0, primary: false, wallpaper: Some("p".into()), span: None }
    }

    #[test]
    fn finds_side_by_side_and_their_overlap() {
        let s = State { monitors: vec![mon("A", 0, 0, 2560, 1440), mon("B", 2560, 180, 1920, 1080)], ..Default::default() };
        let p = pairs(&s);
        assert_eq!(p.len(), 1);
        assert!(!p[0].stacked && p[0].a == "A" && p[0].b == "B");
        assert!((p[0].a_span[0] - 0.125).abs() < 1e-3 && (p[0].a_span[1] - 0.875).abs() < 1e-3);
        assert_eq!(p[0].b_span, [0.0, 1.0]);
    }

    #[test]
    fn arrangement_moves_screens() {
        let mut s = State { monitors: vec![mon("A", 0, 0, 2560, 1440), mon("B", 9000, 0, 2560, 1440)], ..Default::default() };
        assert!(pairs(&s).is_empty());
        s.arrangement.insert("B".into(), [2600, 0]);
        assert_eq!(pairs(&s).len(), 1);
    }

    #[test]
    fn band_meets_in_the_middle_and_fades_inwards() {
        let red = vec![[255.0, 0.0, 0.0]; N];
        let blue = vec![[0.0, 0.0, 255.0]; N];
        let img = band(&red, &blue, [0.0, 1.0], [0.0, 1.0], 1.0, false, true);
        let seam = img.get_pixel(DEPTH - 1, N as u32 / 2).0;
        let inner = img.get_pixel(0, N as u32 / 2).0;
        assert!((seam[0] as i32 - 128).abs() <= 1 && (seam[2] as i32 - 128).abs() <= 1);
        assert!(seam[3] > 200 && inner[3] < 10);
    }
}
