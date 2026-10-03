

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]


mod accent;
mod automation;
mod backend;
mod blend;
mod depth;
mod desktop;
mod conditions;
mod feed;
mod gnome;
mod gpu;
mod host;
mod plasma;
#[cfg(target_os = "linux")]
mod kwin_bridge;
mod looper;
mod pause;
mod previews;
mod render;
mod saved;
mod saver;
mod server;
mod share;
mod video;
mod watch;
mod widgets;

use std::sync::{atomic::AtomicBool, Arc};
use zwall_ipc::{State, PROTOCOL};

fn main() -> anyhow::Result<()> {
    let mut logger = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info,wgpu_core=warn,wgpu_hal=warn,naga=warn,ort=warn"));

    #[cfg(windows)]
    {
        let dir = desktop::data_dir();
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(f) = std::fs::File::create(dir.join("engine.log")) {
            logger.target(env_logger::Target::Pipe(Box::new(f)));
        }
    }
    logger.init();


    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("ctl") {
        return ctl(args.get(2).map(String::as_str).unwrap_or(""));
    }

    let mut backend = backend::detect()?;


    if std::env::args().any(|a| a == "--probe") {
        println!("backend     {}", backend.name());
        for m in backend.monitors()? {
            println!("monitor     {} {}x{}+{}+{} scale {}{}", m.name, m.width, m.height, m.x, m.y, m.scale, if m.primary { " primary" } else { "" });
        }
        println!("fullscreen  {}", backend.fullscreen_active());
        for m in backend.monitors()? {
            let r = backend::Rect { x: m.x, y: m.y, w: m.width, h: m.height };
            println!("covered     {} {:.0}%", m.name, backend.covered(r).unwrap_or(0.0) * 100.0);
        }
        println!("idle        {} ms", backend.idle_ms());
        println!("battery     {}", if desktop::on_battery() { "on battery" } else { "on mains / none" });
        println!("accent      {}", desktop::accent().unwrap_or_else(|| "none".into()));
        if let Some(p) = backend.pointer() {
            println!("pointer     {},{}", p.x, p.y);
        }
        return Ok(());
    }
    let monitors = backend.monitors()?;
    log::info!("backend {} · {} monitor(s)", backend.name(), monitors.len());
    for m in &monitors {
        log::info!("  {} {}x{}+{}+{}{}", m.name, m.width, m.height, m.x, m.y, if m.primary { " (primary)" } else { "" });
    }

    let accent = desktop::accent();
    log::info!("accent colour: {}", accent.as_deref().unwrap_or("none (using ZWall violet)"));
    let mut state = State { protocol: PROTOCOL, backend: backend.name().into(), monitors, accent, ..Default::default() };
    let saved = saved::load();
    saved::apply(&saved, &mut state);
    let hub = Arc::new(server::Hub::new(state));
    hub.persist(saved);
    let stop = Arc::new(AtomicBool::new(false));

    #[cfg(unix)]
    {
        use signal_hook::consts::{SIGINT, SIGTERM};
        signal_hook::flag::register(SIGINT, stop.clone())?;
        signal_hook::flag::register(SIGTERM, stop.clone())?;
    }


    let listener = server::bind()?;

    for m in hub.snapshot().monitors {
        if let Some(p) = m.wallpaper {
            previews::request(hub.clone(), p);
        }
    }
    let h = hub.clone();
    std::thread::Builder::new().name("zwall-ipc".into()).spawn(move || server::serve(listener, h))?;
    let h = hub.clone();
    std::thread::Builder::new().name("zwall-watch".into()).spawn(move || watch::run(h))?;
    let h = hub.clone();
    std::thread::spawn(move || h.set_fonts(widgets::fonts()));


    #[cfg(target_os = "linux")]
    if std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().split(':').any(|d| d.eq_ignore_ascii_case("kde")) {
        kwin_bridge::start();
    }
    let plasma = std::env::var("ZWALL_HOST").as_deref() != Ok("window") && plasma::available();
    if plasma {
        if let Err(e) = plasma::install() {
            log::warn!("plasma: couldn't install the wallpaper plugin: {e:#}");
        }
        hub.set_backend("plasma");
        let feed = feed::Feed::start()?;
        host::run(hub, backend, stop, feed);
    } else {
        if gnome::is_gnome() {
            if let Err(e) = gnome::install() {
                log::warn!("gnome: {e:#}");
            }
            hub.set_backend("gnome");
        }
        render::run(hub, backend, stop);
    }
    zwall_ipc::transport::Server::cleanup();
    log::info!("stopped");
    Ok(())
}

fn ctl(action: &str) -> anyhow::Result<()> {
    use std::io::{BufRead, BufReader, Write};
    let (r, mut w) = zwall_ipc::transport::connect().map_err(|_| anyhow::anyhow!("ZWall isn't running"))?;
    let mut reader = BufReader::new(r);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let zwall_ipc::Event::State(state) = serde_json::from_str(&line)? else { anyhow::bail!("unexpected reply") };
    let req = match action {
        "pause" => if state.paused == zwall_ipc::PauseReason::None { zwall_ipc::Request::Pause } else { zwall_ipc::Request::Resume },
        "mute" => {
            let mut s = state.settings;
            s.mute = !s.mute;
            zwall_ipc::Request::SetSettings(s)
        }
        "next" => zwall_ipc::Request::Next,
        _ => anyhow::bail!("usage: zwall-engine ctl pause|mute|next"),
    };
    writeln!(w, "{}", serde_json::to_string(&req)?)?;
    line.clear();
    reader.read_line(&mut line)?;
    Ok(())
}
