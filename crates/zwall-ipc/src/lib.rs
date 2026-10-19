use serde::{Deserialize, Serialize};
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
};

pub mod transport;

pub const PROTOCOL: u32 = 1;

pub fn socket_path() -> PathBuf {
    if let Some(p) = std::env::var_os("ZWALL_SOCKET") {
        return PathBuf::from(p);
    }
    match std::env::var_os("XDG_RUNTIME_DIR") {
        Some(d) => PathBuf::from(d).join("zwall.sock"),
        None => PathBuf::from(format!("/tmp/zwall-{}.sock", std::env::var("UID").unwrap_or_else(|_| "user".into()))),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Monitor {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,

    pub wallpaper: Option<String>,

    #[serde(default)]
    pub span: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PauseReason {
    #[default]
    None,
    User,
    Fullscreen,
    Covered,
    Battery,
    App,

    Idle,

    Locked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub fps_cap: u32,

    pub quality: f32,

    pub web_fps: u32,
    pub pause_fullscreen: bool,
    pub pause_battery: bool,

    pub pause_idle_minutes: u32,

    pub volume: u32,
    pub mute: bool,

    pub interactive: bool,

    pub pause_apps: Vec<String>,

    pub hotkeys: bool,

    pub when_covered: String,

    pub battery_saver: bool,

    pub follow_daylight: bool,

    pub match_accent: bool,

    pub screensaver_minutes: u32,

    pub resume: bool,

    pub pause_locked: bool,

    pub duck_audio: bool,

    pub blend_edges: bool,

    pub blend_strength: f32,

    pub blend_width: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            fps_cap: 60,
            web_fps: 30,
            blend_edges: false,
            blend_strength: 0.7,
            blend_width: 0.12,
            quality: 1.0,
            pause_fullscreen: true,
            pause_battery: true,
            pause_idle_minutes: 10,
            volume: 50,
            mute: false,
            interactive: true,
            pause_apps: Vec::new(),
            hotkeys: true,
            when_covered: "pause".into(),
            battery_saver: true,
            follow_daylight: false,
            match_accent: false,
            screensaver_minutes: 0,
            resume: true,
            pause_locked: true,
            duck_audio: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    #[default]
    Mouse,

    Drift,
    Still,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Tint {
    #[default]
    Original,

    Accent,
    Mono,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Overlay {
    #[default]
    None,
    Rain,
    Snow,
    Fireflies,
    Grain,
}

impl Overlay {
    pub fn name(self) -> Option<&'static str> {
        match self {
            Overlay::None => None,
            Overlay::Rain => Some("rain"),
            Overlay::Snow => Some("snow"),
            Overlay::Fireflies => Some("fireflies"),
            Overlay::Grain => Some("grain"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Params {
    pub speed: f32,

    pub intensity: f32,

    pub depth: f32,
    pub motion: Motion,
    pub tint: Tint,

    pub volume: f32,

    pub overlay: Overlay,
    pub overlay_amount: f32,

    #[serde(default)]
    pub life: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SceneInfo {
    pub map: String,

    pub found: Vec<String>,
}

impl Default for Params {
    fn default() -> Self {
        Self { speed: 1.0, intensity: 1.0, depth: 0.0, motion: Motion::Mouse, tint: Tint::Original, volume: 1.0, overlay: Overlay::None, overlay_amount: 1.0, life: 0.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Rotation {
    pub every_minutes: u32,

    pub source: String,
    pub shuffle: bool,

    #[serde(default)]
    pub list: Vec<String>,

    #[serde(default)]
    pub label: String,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Trigger {
    At { time: String },

    Every {
        minutes: u32,
        #[serde(default)]
        from: String,
        #[serde(default)]
        to: String,
    },

    AppOpens { app: String },

    OnBattery,

    PluggedIn,

    Startup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Source {
    Everything,
    Favourites,

    Collection { id: String },

    Tag {
        tag: String,
        #[serde(default)]
        builtin: Vec<String>,
    },

    Kind { kind: String },

    List {
        paths: Vec<String>,
        #[serde(default)]
        label: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Play { path: String },

    Random {
        source: Source,
        #[serde(default = "yes")]
        same_everywhere: bool,
    },

    Next { source: Source },
    Pause,
    Resume,
    Mute,
    Unmute,

    Volume { level: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Automation {
    pub id: String,

    #[serde(default)]
    pub name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub trigger: Trigger,
    pub action: Action,

    #[serde(default)]
    pub days: Vec<u8>,

    #[serde(default)]
    pub screens: Vec<String>,

    #[serde(default)]
    pub respect_manual: bool,

    #[serde(default)]
    pub undo_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UserCollection {
    pub id: String,
    pub name: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Slot {
    pub at: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct Meta {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub title: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub author: String,

    #[serde(skip_serializing_if = "String::is_empty")]
    pub source: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub notes: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

impl State {
    pub fn desk(&self, m: &Monitor) -> (i32, i32) {
        self.arrangement.get(&m.name).map_or((m.x, m.y), |p| (p[0], p[1]))
    }
}

impl Meta {
    pub fn is_empty(&self) -> bool {
        *self == Meta::default()
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct Facts {
    pub width: u32,
    pub height: u32,

    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Widget {
    pub id: String,
    pub monitor: String,

    pub kind: String,

    pub style: String,

    pub x: f32,
    pub y: f32,

    pub size: f32,

    pub color: String,
    pub opacity: f32,

    pub font: String,

    pub weight: u32,

    pub effect: String,

    pub align: String,
    pub hour24: bool,
    pub seconds: bool,

    pub text: String,

    pub metrics: Vec<String>,
}

impl Default for Widget {
    fn default() -> Self {
        Self {
            id: String::new(),
            monitor: String::new(),
            kind: "clock".into(),
            style: "digital".into(),
            x: 0.5,
            y: 0.4,
            size: 0.08,
            color: "#f3efe6".into(),
            opacity: 0.95,
            font: String::new(),
            weight: 300,
            effect: "shadow".into(),
            align: "center".into(),
            hour24: true,
            seconds: false,
            text: String::new(),
            metrics: vec!["cpu".into(), "ram".into()],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BlendLink {
    pub a: String,
    pub b: String,

    #[serde(default)]
    pub stacked: bool,
    #[serde(default = "yes")]
    pub enabled: bool,

    pub into_a: f32,
    pub into_b: f32,

    pub a_span: [f32; 2],
    pub b_span: [f32; 2],

    pub strength: f32,
}

impl BlendLink {
    pub fn key(a: &str, b: &str) -> String {
        format!("{a}|{b}")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BlendEdge {
    pub side: String,

    pub image: String,

    pub size: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LibraryItem {
    pub path: String,
    pub name: String,

    pub kind: String,

    #[serde(default)]
    pub added: u64,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_watch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Watch {
    pub id: String,
    pub path: String,
    #[serde(default = "yes")]
    pub enabled: bool,

    #[serde(default = "yes")]
    pub recursive: bool,

    #[serde(default)]
    pub kinds: Vec<String>,

    #[serde(default)]
    pub collection: Option<String>,

    #[serde(default)]
    pub tags: Vec<String>,

    #[serde(default = "yes")]
    pub prune: bool,

    #[serde(default)]
    pub ignored: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct WatchStatus {
    pub found: u32,

    pub scanned: u64,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct State {
    pub protocol: u32,

    pub backend: String,
    pub monitors: Vec<Monitor>,
    pub paused: PauseReason,
    #[serde(default)]
    pub settings: Settings,

    #[serde(default)]
    pub gpu: Option<String>,

    pub gpu_percent: Option<f32>,

    #[serde(default)]
    pub params: std::collections::BTreeMap<String, Params>,

    #[serde(default)]
    pub accent: Option<String>,

    #[serde(default)]
    pub library: Vec<LibraryItem>,

    #[serde(default)]
    pub favourites: Vec<String>,

    #[serde(default)]
    pub tags: std::collections::BTreeMap<String, Vec<String>>,

    #[serde(default)]
    pub tag_list: Vec<String>,

    #[serde(default)]
    pub also_live: Vec<String>,

    #[serde(default)]
    pub resting: std::collections::BTreeMap<String, String>,

    #[serde(default)]
    pub depths: std::collections::BTreeMap<String, String>,

    #[serde(default)]
    pub collections: Vec<UserCollection>,

    #[serde(default)]
    pub arrangement: std::collections::BTreeMap<String, [i32; 2]>,

    #[serde(default)]
    pub widgets: Vec<Widget>,

    #[serde(default)]
    pub fonts: Vec<String>,

    #[serde(default)]
    pub blend_links: std::collections::BTreeMap<String, BlendLink>,

    #[serde(default)]
    pub blend_pairs: Vec<BlendLink>,

    #[serde(default)]
    pub blends: std::collections::BTreeMap<String, Vec<BlendEdge>>,

    #[serde(default)]
    pub watches: Vec<Watch>,
    #[serde(default)]
    pub watch_status: std::collections::BTreeMap<String, WatchStatus>,

    #[serde(default)]
    pub automations: Vec<Automation>,

    #[serde(default)]
    pub manual: std::collections::BTreeMap<String, String>,

    #[serde(default)]
    pub automation_runs: std::collections::BTreeMap<String, u64>,

    #[serde(default)]
    pub scenes: std::collections::BTreeMap<String, SceneInfo>,

    #[serde(default)]
    pub durations: std::collections::BTreeMap<String, f32>,

    #[serde(default)]
    pub jobs: std::collections::BTreeMap<String, String>,

    #[serde(default)]
    pub shortcuts: Vec<String>,

    #[serde(default)]
    pub meta: std::collections::BTreeMap<String, Meta>,

    #[serde(default)]
    pub facts: std::collections::BTreeMap<String, Facts>,

    #[serde(default)]
    pub thumbs: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Request {
    GetState,

    SetWallpaper { path: String, monitors: Vec<String> },

    Span { path: String, monitors: Vec<String> },
    Clear { monitor: String },
    Pause,
    Resume,
    Next,
    SetSettings(Settings),
    SetParams { path: String, params: Params },
    AddToLibrary(LibraryItem),
    RemoveFromLibrary { path: String },
    SetFavourite { path: String, on: bool },
    SetTags { path: String, tags: Vec<String> },

    SetMeta { path: String, meta: Meta },

    SetCollections(Vec<UserCollection>),

    SetAutomations(Vec<Automation>),

    SetWidgets(Vec<Widget>),

    SetBlendLinks(std::collections::BTreeMap<String, BlendLink>),

    SetArrangement(std::collections::BTreeMap<String, [i32; 2]>),

    SetWatches(Vec<Watch>),

    RescanWatches,

    RunAutomation { id: String },

    ClearManual,

    Quit,

    ClearParams { path: String },
    SetTagList(Vec<String>),
    SetAlsoLive { path: String, on: bool },

    Export {
        path: String,

        #[serde(default)]
        name: Option<String>,
    },

    MakeLoop {
        path: String,

        start: f32,
        end: f32,
        crossfade: f32,

        find_best: bool,
    },

    Import { file: String },

    MakePreview { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Event {
    State(Box<State>),
    Error(String),

    Notice(String),
}

pub fn write_msg<W: Write, T: Serialize>(w: &mut W, msg: &T) -> io::Result<()> {
    let mut line = serde_json::to_vec(msg)?;
    line.push(b'\n');
    w.write_all(&line)?;
    w.flush()
}

pub fn read_msg<R: BufRead, T: for<'de> Deserialize<'de>>(r: &mut R, buf: &mut String) -> io::Result<Option<T>> {
    buf.clear();
    if r.read_line(buf)? == 0 {
        return Ok(None);
    }
    serde_json::from_str(buf.trim_end()).map(Some).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_round_trip() {
        let req = Request::Span { path: "/w/aurora.zwall".into(), monitors: vec!["DP-1".into(), "HDMI-A-1".into()] };
        let mut buf = Vec::new();
        write_msg(&mut buf, &req).unwrap();
        write_msg(&mut buf, &Request::GetState).unwrap();
        let mut r = io::Cursor::new(buf);
        let mut s = String::new();
        assert_eq!(read_msg::<_, Request>(&mut r, &mut s).unwrap(), Some(req));
        assert_eq!(read_msg::<_, Request>(&mut r, &mut s).unwrap(), Some(Request::GetState));
        assert_eq!(read_msg::<_, Request>(&mut r, &mut s).unwrap(), None);
    }
}

pub const SCREEN_KEY: &str = "#screen=";

pub fn screen_key(path: &str, monitor: &str) -> String {
    format!("{path}{SCREEN_KEY}{monitor}")
}

pub fn key_path(key: &str) -> &str {
    key.split_once(SCREEN_KEY).map_or(key, |(p, _)| p)
}

impl State {
    pub fn params_for(&self, path: &str, monitor: &str) -> Params {
        self.params.get(&screen_key(path, monitor)).or_else(|| self.params.get(path)).copied().unwrap_or_default()
    }
}

#[cfg(test)]
mod screen_tests {
    use super::*;

    #[test]
    fn screen_overrides_win() {
        let mut s = State::default();
        s.params.insert("/a.jpg".into(), Params { speed: 2.0, ..Default::default() });
        s.params.insert(screen_key("/a.jpg", "DP-3"), Params { speed: 0.5, ..Default::default() });
        assert_eq!(s.params_for("/a.jpg", "DP-1").speed, 2.0);
        assert_eq!(s.params_for("/a.jpg", "DP-3").speed, 0.5);
        assert_eq!(key_path(&screen_key("/x@2x.png", "DP-1")), "/x@2x.png");
    }
}
