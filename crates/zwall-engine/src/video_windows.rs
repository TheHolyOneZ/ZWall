use std::{
    fs::File,
    io::{Read, Write},
    os::windows::io::AsRawHandle,
    path::PathBuf,
    process::{Child, Stdio},
    sync::atomic::{AtomicU32, Ordering},
    time::{Duration, Instant},
};
use windows::Win32::{Foundation::HANDLE, System::Pipes::PeekNamedPipe};

static NEXT: AtomicU32 = AtomicU32::new(0);

pub struct Video {
    child: Child,
    pipe: Option<File>,
    paused: bool,
    volume: f64,
    speed: f64,
}

pub fn mpv_exe() -> Option<PathBuf> {
    let beside = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("mpv.exe")));
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let candidates = [
        beside,
        env("ProgramFiles").map(|p| p.join("mpv").join("mpv.exe")),
        env("LOCALAPPDATA").map(|p| p.join("Programs").join("mpv").join("mpv.exe")),
        env("USERPROFILE").map(|p| p.join("scoop").join("apps").join("mpv").join("current").join("mpv.exe")),
        env("ProgramData").map(|p| p.join("chocolatey").join("bin").join("mpv.exe")),
    ];
    candidates.into_iter().flatten().find(|p| p.is_file()).or_else(|| crate::desktop::on_path("mpv.exe"))
}

impl Video {
    pub fn new(wid: u64, path: &str) -> anyhow::Result<Self> {
        let exe = mpv_exe().ok_or_else(|| anyhow::anyhow!("video wallpapers need mpv: install it from mpv.io (or `scoop install mpv`), or put mpv.exe next to ZWall"))?;
        let pipe_name = format!(r"\\.\pipe\zwall-mpv-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
        let child = crate::desktop::command(&exe)
            .arg(format!("--wid={wid}"))
            .args([
                "--loop-file=inf",
                "--panscan=1.0",
                "--hwdec=auto-safe",
                "--osc=no",
                "--osd-level=0",
                "--input-default-bindings=no",
                "--input-vo-keyboard=no",
                "--input-cursor=no",
                "--cursor-autohide=no",
                "--stop-screensaver=no",
                "--no-terminal",
                "--force-window=yes",
                "--volume=0",
                "--audio-client-name=ZWall",
            ])
            .arg(format!("--input-ipc-server={pipe_name}"))
            .arg("--")
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| anyhow::anyhow!("couldn't start mpv ({}): {e}", exe.display()))?;

        let started = Instant::now();
        let mut pipe = None;
        while started.elapsed() < Duration::from_secs(3) {
            if let Ok(f) = std::fs::OpenOptions::new().read(true).write(true).open(&pipe_name) {
                pipe = Some(f);
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        if pipe.is_none() {
            log::warn!("mpv: no control pipe; the video plays but can't be paused or muted");
        }
        Ok(Self { child, pipe, paused: false, volume: 0.0, speed: 1.0 })
    }

    fn send(&mut self, args: serde_json::Value) {
        let Some(pipe) = self.pipe.as_mut() else { return };
        let line = format!("{}\n", serde_json::json!({ "command": args }));
        if pipe.write_all(line.as_bytes()).is_err() {
            self.pipe = None;
        }
        self.drain();
    }

    fn drain(&mut self) {
        let Some(pipe) = self.pipe.as_mut() else { return };
        let handle = HANDLE(pipe.as_raw_handle());
        let mut buf = [0u8; 4096];
        loop {
            let mut avail = 0u32;

            let ok = unsafe { PeekNamedPipe(handle, None, 0, None, Some(&mut avail), None) };
            if ok.is_err() || avail == 0 {
                return;
            }
            let n = (avail as usize).min(buf.len());
            if pipe.read(&mut buf[..n]).unwrap_or(0) == 0 {
                return;
            }
        }
    }

    pub fn draw(&mut self) {
        self.drain();
    }

    pub fn set_paused(&mut self, paused: bool) {
        if self.paused != paused {
            self.paused = paused;
            self.send(serde_json::json!(["set_property", "pause", paused]));
        }
    }

    pub fn set_volume(&mut self, volume: f64) {
        if (self.volume - volume).abs() > 0.1 {
            self.volume = volume;
            self.send(serde_json::json!(["set_property", "volume", volume]));
        }
    }

    pub fn set_speed(&mut self, speed: f64) {
        let speed = speed.clamp(0.05, 3.0);
        if (self.speed - speed).abs() > 0.001 {
            self.speed = speed;
            self.send(serde_json::json!(["set_property", "speed", speed]));
        }
    }
}

impl Drop for Video {
    fn drop(&mut self) {
        self.send(serde_json::json!(["quit"]));
        self.pipe = None;
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            std::thread::sleep(Duration::from_millis(80));
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}
