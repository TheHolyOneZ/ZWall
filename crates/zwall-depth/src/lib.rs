

use anyhow::Context;
use image::{imageops::FilterType, GrayImage, RgbImage};
use ort::{session::Session, value::Tensor};
use std::path::{Path, PathBuf};

pub mod mesh;
pub mod segment;

const MODEL_URL: &str = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx";
const MODEL_FILE: &str = "depth-anything-v2-small-q.onnx";

const LONG_SIDE: u32 = 518;


pub(crate) fn quiet_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}


#[derive(Debug, Clone)]
pub struct DepthMap {
    pub width: u32,
    pub height: u32,
    pub data: Vec<f32>,
}


pub fn ensure_model(cache: &Path) -> anyhow::Result<PathBuf> {
    let path = cache.join(MODEL_FILE);
    if path.exists() {
        return Ok(path);
    }
    std::fs::create_dir_all(cache)?;
    log::info!("depth: downloading the depth model (27 MB, once)");
    let tmp = path.with_extension("part");
    let status = crate::quiet_command("curl").args(["-fsSL", "--retry", "2", "-o"]).arg(&tmp).arg(MODEL_URL).status().context("curl is needed to download the depth model")?;
    anyhow::ensure!(status.success(), "downloading the depth model failed");
    std::fs::rename(&tmp, &path)?;
    Ok(path)
}

pub struct DepthModel {
    session: Session,
}

impl DepthModel {
    pub fn load(model: &Path) -> anyhow::Result<Self> {
        let session = Session::builder()?.commit_from_file(model).with_context(|| format!("loading {}", model.display()))?;
        Ok(Self { session })
    }


    pub fn estimate(&mut self, photo: &RgbImage) -> anyhow::Result<DepthMap> {
        let (w, h) = model_size(photo.width(), photo.height());
        let small = image::imageops::resize(photo, w, h, FilterType::Triangle);

        const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
        const STD: [f32; 3] = [0.229, 0.224, 0.225];
        let plane = (w * h) as usize;
        let mut input = vec![0f32; 3 * plane];
        for (i, p) in small.pixels().enumerate() {
            for c in 0..3 {
                input[c * plane + i] = (p.0[c] as f32 / 255.0 - MEAN[c]) / STD[c];
            }
        }
        let tensor = Tensor::from_array((vec![1i64, 3, h as i64, w as i64], input))?;
        let outputs = self.session.run(ort::inputs![tensor])?;
        let (shape, raw) = outputs[0].try_extract_tensor::<f32>()?;
        let (ow, oh) = (shape[shape.len() - 1] as u32, shape[shape.len() - 2] as u32);
        let (lo, hi) = raw.iter().fold((f32::MAX, f32::MIN), |(lo, hi), v| (lo.min(*v), hi.max(*v)));
        let span = (hi - lo).max(1e-6);
        Ok(DepthMap { width: ow, height: oh, data: raw.iter().map(|v| (v - lo) / span).collect() })
    }
}


fn model_size(w: u32, h: u32) -> (u32, u32) {
    let scale = LONG_SIDE as f32 / w.max(h) as f32;
    let snap = |v: f32| ((v / 14.0).round().max(1.0) * 14.0) as u32;
    (snap(w as f32 * scale), snap(h as f32 * scale))
}

impl DepthMap {

    pub fn to_image(&self, width: u32) -> GrayImage {
        let raw = GrayImage::from_fn(self.width, self.height, |x, y| image::Luma([(self.data[(y * self.width + x) as usize] * 255.0).round() as u8]));
        let height = ((width as f32 / self.width as f32) * self.height as f32).round() as u32;
        let big = image::imageops::resize(&raw, width, height.max(1), FilterType::CatmullRom);
        image::imageops::blur(&big, 2.0)
    }
}


pub fn flat(width: u32, height: u32) -> DepthMap {
    DepthMap { width, height, data: vec![0.5; (width * height) as usize] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_input_is_patch_aligned() {
        let (w, h) = model_size(2560, 1440);
        assert_eq!((w % 14, h % 14), (0, 0));
        assert_eq!(w, 518);
        assert!((w as f32 / h as f32 - 16.0 / 9.0).abs() < 0.1);
    }

    #[test]
    fn depth_image_keeps_aspect() {
        let img = flat(28, 14).to_image(200);
        assert_eq!((img.width(), img.height()), (200, 100));
    }
}
