use anyhow::Context;
use image::{imageops::FilterType, RgbImage, RgbaImage};
use ort::{session::Session, value::Tensor};
use std::path::{Path, PathBuf};

const MODEL_URL: &str = "https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/resolve/main/onnx/model_quantized.onnx";
const MODEL_FILE: &str = "segformer-b0-ade-q.onnx";
const SIDE: u32 = 512;

const SKY: &[usize] = &[2];
const WATER: &[usize] = &[21, 26, 60, 104, 113, 128];
const PLANTS: &[usize] = &[4, 9, 17, 66, 72];
const LIGHTS: &[usize] = &[36, 82];

#[derive(Debug, Clone, Default)]
pub struct Found {
    pub sky: bool,
    pub water: bool,
    pub plants: bool,
    pub lights: bool,
}

impl Found {
    pub fn names(&self) -> Vec<&'static str> {
        [(self.sky, "sky"), (self.water, "water"), (self.plants, "plants"), (self.lights, "lights")].into_iter().filter(|(on, _)| *on).map(|(_, n)| n).collect()
    }
}

pub fn ensure_model(cache: &Path) -> anyhow::Result<PathBuf> {
    let path = cache.join(MODEL_FILE);
    if path.exists() {
        return Ok(path);
    }
    std::fs::create_dir_all(cache)?;
    log::info!("scene: downloading the scene model (4 MB, once)");
    let tmp = path.with_extension("part");
    let status = crate::quiet_command("curl").args(["-fsSL", "--retry", "2", "-o"]).arg(&tmp).arg(MODEL_URL).status().context("curl is needed to download the scene model")?;
    anyhow::ensure!(status.success(), "downloading the scene model failed");
    std::fs::rename(&tmp, &path)?;
    Ok(path)
}

pub struct SceneModel {
    session: Session,
}

impl SceneModel {
    pub fn load(model: &Path) -> anyhow::Result<Self> {
        Ok(Self { session: Session::builder()?.commit_from_file(model).with_context(|| format!("loading {}", model.display()))? })
    }

    pub fn motion_map(&mut self, photo: &RgbImage, width: u32) -> anyhow::Result<(RgbaImage, Found)> {
        let small = image::imageops::resize(photo, SIDE, SIDE, FilterType::Triangle);
        const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
        const STD: [f32; 3] = [0.229, 0.224, 0.225];
        let plane = (SIDE * SIDE) as usize;
        let mut input = vec![0f32; 3 * plane];
        for (i, p) in small.pixels().enumerate() {
            for c in 0..3 {
                input[c * plane + i] = (p.0[c] as f32 / 255.0 - MEAN[c]) / STD[c];
            }
        }
        let tensor = Tensor::from_array((vec![1i64, 3, SIDE as i64, SIDE as i64], input))?;
        let outputs = self.session.run(ort::inputs![tensor])?;
        let (shape, logits) = outputs[0].try_extract_tensor::<f32>()?;
        let (classes, h, w) = (shape[1] as usize, shape[2] as usize, shape[3] as usize);
        let mut map = RgbaImage::new(w as u32, h as u32);
        let mut counts = [0usize; 4];
        for y in 0..h {
            for x in 0..w {
                let mut best = (0, f32::MIN);
                for c in 0..classes {
                    let v = logits[(c * h + y) * w + x];
                    if v > best.1 {
                        best = (c, v);
                    }
                }
                let region = [SKY, WATER, PLANTS, LIGHTS].iter().position(|r| r.contains(&best.0));
                let mut px = [0u8; 4];
                if let Some(r) = region {
                    px[r] = 255;
                    counts[r] += 1;
                }
                map.put_pixel(x as u32, y as u32, image::Rgba(px));
            }
        }

        let total = (w * h) as f32;
        let share = |i: usize, min: f32| counts[i] as f32 / total >= min;
        let found = Found { sky: share(0, 0.04), water: share(1, 0.03), plants: share(2, 0.04), lights: share(3, 0.002) };

        for p in map.pixels_mut() {
            for (i, on) in [found.sky, found.water, found.plants, found.lights].into_iter().enumerate() {
                if !on {
                    p.0[i] = 0;
                }
            }
        }
        let height = ((width as f32 / photo.width() as f32) * photo.height() as f32).round().max(1.0) as u32;
        let big = image::imageops::resize(&map, width, height, FilterType::Triangle);
        let mut out = image::imageops::blur(&big, 3.0);
        for p in out.pixels_mut() {
            p.0[3] = 255 - p.0[3];
        }
        Ok((out, found))
    }
}
