use super::Rect;
use serde_json::Value;
use std::{
    cell::RefCell,
    io::{Read, Write},
    os::unix::net::UnixStream,
    path::PathBuf,
    time::{Duration, Instant},
};

#[derive(Clone)]
struct Mon {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    scale: f64,
    workspace: i64,
}

pub struct Hyprland {
    socket: PathBuf,
    cursor: RefCell<(Instant, Option<(i32, i32)>)>,
}

impl Hyprland {
    pub fn connect() -> Option<Self> {
        let sig = std::env::var("HYPRLAND_INSTANCE_SIGNATURE").ok()?;
        let runtime = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from)?;
        let socket = [runtime.join("hypr").join(&sig).join(".socket.sock"), PathBuf::from("/tmp/hypr").join(&sig).join(".socket.sock")].into_iter().find(|p| p.exists())?;
        let h = Self { socket, cursor: RefCell::new((Instant::now() - Duration::from_secs(1), None)) };
        h.ask("monitors").is_some().then(|| {
            log::info!("hyprland: using its IPC for cursor, fullscreen and window info");
            h
        })
    }

    fn ask(&self, what: &str) -> Option<Value> {
        let mut s = UnixStream::connect(&self.socket).ok()?;
        s.set_read_timeout(Some(Duration::from_millis(200))).ok()?;
        s.write_all(format!("j/{what}").as_bytes()).ok()?;
        let mut buf = String::new();
        s.read_to_string(&mut buf).ok()?;
        serde_json::from_str(&buf).ok()
    }

    fn monitors(&self) -> Vec<Mon> {
        self.ask("monitors").and_then(|v| v.as_array().cloned()).unwrap_or_default().iter().map(|m| {
            let scale = m["scale"].as_f64().unwrap_or(1.0).max(0.1);

            Mon {
                x: m["x"].as_f64().unwrap_or(0.0),
                y: m["y"].as_f64().unwrap_or(0.0),
                w: m["width"].as_f64().unwrap_or(0.0) / scale,
                h: m["height"].as_f64().unwrap_or(0.0) / scale,
                scale,
                workspace: m["activeWorkspace"]["id"].as_i64().unwrap_or(0),
            }
        }).collect()
    }

    fn to_physical(mons: &[Mon], x: f64, y: f64) -> (i32, i32) {
        let k = mons.iter().find(|m| x >= m.x && y >= m.y && x < m.x + m.w && y < m.y + m.h).map_or(1.0, |m| m.scale.round().max(1.0));
        ((x * k) as i32, (y * k) as i32)
    }

    pub fn cursor(&self) -> Option<(i32, i32)> {
        let mut c = self.cursor.borrow_mut();
        if c.0.elapsed() >= Duration::from_millis(15) {
            let pos = self.ask("cursorpos").and_then(|v| Some((v["x"].as_f64()?, v["y"].as_f64()?)));
            c.1 = pos.map(|(x, y)| Self::to_physical(&self.monitors_cached(), x, y));
            c.0 = Instant::now();
        }
        c.1
    }

    fn monitors_cached(&self) -> Vec<Mon> {
        thread_local! {
            static CACHE: RefCell<(Option<Instant>, Vec<Mon>)> = const { RefCell::new((None, Vec::new())) };
        }
        CACHE.with(|c| {
            let mut c = c.borrow_mut();
            if c.0.is_none_or(|t| t.elapsed() > Duration::from_secs(2)) {
                *c = (Some(Instant::now()), self.monitors());
            }
            c.1.clone()
        })
    }

    pub fn fullscreen(&self) -> bool {
        self.ask("activewindow").is_some_and(|w| match &w["fullscreen"] {
            Value::Bool(b) => *b,
            Value::Number(n) => n.as_i64().unwrap_or(0) > 0,
            _ => false,
        })
    }

    pub fn covered(&self, rect: Rect) -> Option<f32> {
        let mons = self.monitors();
        let visible: Vec<i64> = mons.iter().map(|m| m.workspace).collect();
        let wins: Vec<(i32, i32, i32, i32)> = self
            .ask("clients")?
            .as_array()?
            .iter()
            .filter(|c| c["mapped"].as_bool() != Some(false) && c["hidden"].as_bool() != Some(true) && visible.contains(&c["workspace"]["id"].as_i64().unwrap_or(i64::MIN)))
            .map(|c| {
                let (x, y) = Self::to_physical(&mons, c["at"][0].as_f64().unwrap_or(0.0), c["at"][1].as_f64().unwrap_or(0.0));
                let (x2, y2) = Self::to_physical(&mons, c["at"][0].as_f64().unwrap_or(0.0) + c["size"][0].as_f64().unwrap_or(0.0) - 0.01, c["at"][1].as_f64().unwrap_or(0.0) + c["size"][1].as_f64().unwrap_or(0.0) - 0.01);
                (x, y, x2, y2)
            })
            .collect();
        let (cols, rows) = (32, 18);
        let mut hit = 0;
        for j in 0..rows {
            for i in 0..cols {
                let x = rect.x + ((i as f32 + 0.5) / cols as f32 * rect.w as f32) as i32;
                let y = rect.y + ((j as f32 + 0.5) / rows as f32 * rect.h as f32) as i32;
                if wins.iter().any(|w| x >= w.0 && y >= w.1 && x <= w.2 && y <= w.3) {
                    hit += 1;
                }
            }
        }
        Some(hit as f32 / (cols * rows) as f32)
    }
}
