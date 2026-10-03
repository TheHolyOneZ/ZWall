

use crate::server::Hub;
use zwall_render::image::{self, RgbaImage};


pub fn dominant(img: &RgbaImage) -> [u8; 3] {
    let small = image::imageops::thumbnail(img, 48, 27);
    let (mut r, mut g, mut b, mut w) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
    for p in small.pixels() {
        let [pr, pg, pb, _] = p.0.map(|c| c as f32 / 255.0);
        let max = pr.max(pg).max(pb);
        let min = pr.min(pg).min(pb);
        let sat = if max > 0.0 { (max - min) / max } else { 0.0 };
        let weight = sat * sat * max + 0.002;
        r += pr * weight;
        g += pg * weight;
        b += pb * weight;
        w += weight;
    }
    let (r, g, b) = (r / w, g / w, b / w);

    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let h = if d == 0.0 {
        0.0
    } else if max == r {
        ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    } * 60.0;
    let s = if max > 0.0 { d / max } else { 0.0 }.clamp(0.35, 0.8);
    let v = max.clamp(0.6, 0.85);
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0).rem_euclid(2.0) - 1.0).abs());
    let (r1, g1, b1) = match h as u32 {
        0..=59 => (c, x, 0.0),
        60..=119 => (x, c, 0.0),
        120..=179 => (0.0, c, x),
        180..=239 => (0.0, x, c),
        240..=299 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    [r1, g1, b1].map(|v| ((v + m) * 255.0).round() as u8)
}

fn apply(hex: &str) -> anyhow::Result<()> {
    let out = std::process::Command::new("plasma-apply-colorscheme").args(["--accent-color", hex]).output()?;
    anyhow::ensure!(out.status.success(), "plasma-apply-colorscheme: {}", String::from_utf8_lossy(&out.stderr).trim());
    Ok(())
}

pub struct AccentSync {
    last: Option<String>,
}

impl AccentSync {
    pub fn new() -> Self {
        Self { last: None }
    }


    pub fn tick(&mut self, hub: &Hub) {
        let s = hub.snapshot();
        if !s.settings.match_accent {
            if let Some(original) = hub.accent_original() {
                match apply(&original) {
                    Ok(()) => log::info!("accent: restored {original}"),
                    Err(e) => log::warn!("accent: couldn't restore {original}: {e:#}"),
                }
                hub.set_accent_original(None);
                hub.set_accent(Some(original));
            }
            self.last = None;
            return;
        }
        let playing = s.monitors.iter().filter(|m| m.wallpaper.is_some()).min_by_key(|m| !m.primary);
        let Some(path) = playing.and_then(|m| m.wallpaper.clone()) else { return };
        if self.last.as_ref() == Some(&path) {
            return;
        }
        self.last = Some(path.clone());
        let file = if path.starts_with("preset://") || zwall_render::is_video(&path) { s.thumbs.get(&path).cloned() } else { Some(path.clone()) };
        let Some(img) = file.and_then(|f| image::open(f).ok()) else { return };
        let [r, g, b] = dominant(&img.to_rgba8());
        let hex = format!("#{r:02x}{g:02x}{b:02x}");
        if hub.accent_original().is_none() {
            hub.set_accent_original(Some(s.accent.clone().unwrap_or_else(|| "#3daee9".into())));
        }
        match apply(&hex) {
            Ok(()) => {
                log::info!("accent: {hex} from {path}");
                hub.set_accent(Some(hex));
            }
            Err(e) => log::warn!("accent: {e:#}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_colour_not_the_grey() {

        let img = RgbaImage::from_fn(96, 54, |x, _| if x < 70 { image::Rgba([40, 40, 44, 255]) } else { image::Rgba([240, 120, 40, 255]) });
        let [r, g, b] = dominant(&img);
        assert!(r > g && g > b, "{r} {g} {b}");

        let grey = RgbaImage::from_pixel(10, 10, image::Rgba([90, 90, 90, 255]));
        let [r, g, b] = dominant(&grey);
        assert!(r.max(g).max(b) >= 150);
    }
}
