fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let cache = std::path::PathBuf::from(std::env::var("HOME")?).join(".cache/zwall/models");
    let mut m = zwall_depth::segment::SceneModel::load(&zwall_depth::segment::ensure_model(&cache)?)?;
    let photo = image::open(&args[1])?.to_rgb8();
    let t = std::time::Instant::now();
    let (map, found) = m.motion_map(&photo, 1024)?;
    println!("found {:?} in {:?}", found.names(), t.elapsed());
    map.save(&args[2])?;
    Ok(())
}
