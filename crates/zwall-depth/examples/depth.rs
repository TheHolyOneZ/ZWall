

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let cache = std::path::PathBuf::from(std::env::var("HOME")?).join(".cache/zwall/models");
    let model = zwall_depth::ensure_model(&cache)?;
    let mut m = zwall_depth::DepthModel::load(&model)?;
    let photo = image::open(&args[1])?.to_rgb8();
    let t = std::time::Instant::now();
    let depth = m.estimate(&photo)?;
    println!("depth {}x{} in {:?}", depth.width, depth.height, t.elapsed());
    depth.to_image(1024).save(&args[2])?;
    Ok(())
}
