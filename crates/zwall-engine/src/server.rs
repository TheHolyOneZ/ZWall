use std::{
    io::BufReader,
    sync::{Arc, Mutex},
    thread,
};
use zwall_ipc::{read_msg, transport, write_msg, Event, Monitor, Params, PauseReason, Request, Settings, State};

pub struct Hub {
    state: Mutex<State>,
    clients: Mutex<Vec<(u64, transport::Writer)>>,
    saved: Mutex<Option<crate::saved::Saved>>,

    quit: std::sync::atomic::AtomicBool,
}

impl Hub {
    pub fn new(state: State) -> Self {
        Self { state: Mutex::new(state), clients: Mutex::new(Vec::new()), saved: Mutex::new(None), quit: Default::default() }
    }

    pub fn request_quit(&self) {
        log::info!("quit requested");
        self.quit.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn quitting(&self) -> bool {
        self.quit.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn persist(self: &Arc<Self>, saved: crate::saved::Saved) {
        *self.saved.lock().unwrap() = Some(saved);
    }

    pub fn snapshot(&self) -> State {
        self.state.lock().unwrap().clone()
    }

    pub fn set_thumbnails(&self, thumbs: std::collections::BTreeMap<String, String>) {
        self.state.lock().unwrap().thumbs.extend(thumbs);
        self.broadcast();
    }

    pub fn set_job(&self, path: &str, job: Option<String>) {
        {
            let mut s = self.state.lock().unwrap();
            match job {
                Some(j) => s.jobs.insert(path.to_string(), j),
                None => s.jobs.remove(path),
            };
        }
        self.broadcast();
    }

    pub fn set_scene(&self, path: String, info: zwall_ipc::SceneInfo) {
        self.state.lock().unwrap().scenes.insert(path, info);
        self.broadcast();
    }

    pub fn set_depth(&self, path: String, png: String) {
        self.state.lock().unwrap().depths.insert(path, png);
        self.broadcast();
    }

    pub fn set_duration(&self, path: String, secs: f32) {
        self.state.lock().unwrap().durations.insert(path, secs);
        self.broadcast();
    }

    pub fn set_facts(&self, path: String, facts: zwall_ipc::Facts) {
        self.state.lock().unwrap().facts.insert(path, facts);
        self.broadcast();
    }

    pub fn add_thumbnail(&self, path: String, file: String) {
        self.state.lock().unwrap().thumbs.insert(path, file);
        self.broadcast();
    }

    pub fn set_auto_pause(&self, reason: PauseReason) {
        {
            let mut s = self.state.lock().unwrap();
            if s.paused == PauseReason::User || s.paused == reason {
                return;
            }
            log::info!("pause: {:?} → {reason:?}", s.paused);
            s.paused = reason;
        }
        self.broadcast();
    }

    pub fn plasma_originals(&self) -> std::collections::BTreeMap<String, crate::plasma::Original> {
        self.saved.lock().unwrap().as_ref().map(|s| s.plasma.clone()).unwrap_or_default()
    }

    pub fn set_plasma_original(&self, monitor: &str, original: Option<crate::plasma::Original>) {
        let mut saved = self.saved.lock().unwrap();
        let Some(saved) = saved.as_mut() else { return };
        match original {
            Some(o) => saved.plasma.insert(monitor.to_string(), o),
            None => saved.plasma.remove(monitor),
        };
        let state = self.state.lock().unwrap().clone();
        crate::saved::store(&state, saved);
    }

    pub fn set_auto(&self, monitor: &str, path: String) {
        {
            let mut s = self.state.lock().unwrap();
            let group = s.monitors.iter().find(|m| m.name == monitor).and_then(|m| m.span.clone());
            for m in s.monitors.iter_mut() {
                if m.name == monitor || (group.is_some() && m.span == group) {
                    m.wallpaper = Some(path.clone());
                }
            }
        }
        self.broadcast();
    }

    pub fn apply_watch(&self, results: Vec<crate::watch::Scan>) {
        let mut changed = false;
        {
            let mut s = self.state.lock().unwrap();
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            for r in results {
                let Some(w) = s.watches.iter().find(|w| w.id == r.id).cloned() else { continue };
                let status = zwall_ipc::WatchStatus { found: r.found.len() as u32, scanned: now, error: r.error.clone() };
                if s.watch_status.get(&w.id).map(|x| (x.found, &x.error)) != Some((status.found, &status.error)) {
                    changed = true;
                }
                s.watch_status.insert(w.id.clone(), status);
                if r.error.is_some() {
                    continue;
                }
                for f in &r.found {
                    if w.ignored.contains(&f.path) || s.library.iter().any(|i| i.path == f.path) {
                        continue;
                    }
                    log::info!("watch {}: new {} {}", w.path, f.kind, f.path);
                    s.library.insert(0, zwall_ipc::LibraryItem { path: f.path.clone(), name: f.name.clone(), kind: f.kind.into(), added: now, from_watch: Some(w.id.clone()) });
                    let mut tags: Vec<String> = Vec::new();
                    for t in w.tags.iter().chain(f.tags.iter()) {
                        if !tags.contains(t) {
                            tags.push(t.clone());
                        }
                    }
                    if !tags.is_empty() && !s.tags.contains_key(&f.path) {
                        s.tags.insert(f.path.clone(), tags);
                    }
                    if let Some(c) = w.collection.as_ref().and_then(|id| s.collections.iter_mut().find(|c| &c.id == id)) {
                        if !c.paths.contains(&f.path) {
                            c.paths.push(f.path.clone());
                        }
                    }
                    changed = true;
                }
                if w.prune {
                    let gone: Vec<String> = s
                        .library
                        .iter()
                        .filter(|i| i.from_watch.as_deref() == Some(w.id.as_str()) && !std::path::Path::new(&i.path).exists())
                        .map(|i| i.path.clone())
                        .collect();
                    for p in gone {
                        log::info!("watch {}: {} is gone", w.path, p);
                        forget(&mut s, &p);
                        changed = true;
                    }
                }
            }
        }
        if changed {
            self.broadcast();
        }
    }

    pub fn set_fonts(&self, fonts: Vec<String>) {
        self.state.lock().unwrap().fonts = fonts;
        self.broadcast();
    }

    pub fn set_blend_pairs(&self, pairs: Vec<zwall_ipc::BlendLink>) {
        let changed = {
            let mut s = self.state.lock().unwrap();
            let changed = s.blend_pairs != pairs;
            s.blend_pairs = pairs;
            changed
        };
        if changed {
            self.broadcast();
        }
    }

    pub fn set_blends(&self, blends: std::collections::BTreeMap<String, Vec<zwall_ipc::BlendEdge>>) {
        let changed = {
            let mut s = self.state.lock().unwrap();
            let changed = s.blends != blends;
            s.blends = blends;
            changed
        };
        if changed {
            self.broadcast();
        }
    }

    pub fn mark_run(&self, id: &str) {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        self.state.lock().unwrap().automation_runs.insert(id.to_string(), now);
        self.broadcast();
    }

    pub fn hotkey(&self, h: crate::backend::Hotkey) {
        use crate::backend::Hotkey;
        let req = match h {
            Hotkey::Pause => {
                if self.snapshot().paused == PauseReason::None { Request::Pause } else { Request::Resume }
            }
            Hotkey::Mute => {
                let mut s = self.snapshot().settings;
                s.mute = !s.mute;
                Request::SetSettings(s)
            }
            Hotkey::Next => Request::Next,
        };
        if self.handle(req).is_ok() {
            self.broadcast();
        }
    }

    pub fn set_gpu_percent(&self, p: Option<f32>) {
        {
            let mut s = self.state.lock().unwrap();
            let rounded = p.map(|v| (v * 10.0).round() / 10.0);
            match (s.gpu_percent, rounded) {
                (Some(a), Some(b)) if (a - b).abs() < 0.3 => return,
                (a, b) if a == b => return,
                _ => s.gpu_percent = rounded,
            }
        }
        self.broadcast();
    }

    pub fn notice(&self, text: String) {
        log::info!("{text}");
        let ev = Event::Notice(text);
        self.clients.lock().unwrap().retain_mut(|(_, w)| write_msg(w, &ev).is_ok());
    }

    pub fn notice_error(&self, text: String) {
        log::warn!("{text}");
        let ev = Event::Error(text);
        self.clients.lock().unwrap().retain_mut(|(_, w)| write_msg(w, &ev).is_ok());
    }

    pub fn request(&self, req: Request) {
        match self.handle(req) {
            Ok(()) => self.broadcast(),
            Err(e) => self.notice_error(e),
        }
    }

    pub fn accent_original(&self) -> Option<String> {
        self.saved.lock().unwrap().as_ref().and_then(|s| s.accent_original.clone())
    }

    pub fn set_accent_original(&self, original: Option<String>) {
        let mut saved = self.saved.lock().unwrap();
        let Some(saved) = saved.as_mut() else { return };
        saved.accent_original = original;
        let state = self.state.lock().unwrap().clone();
        crate::saved::store(&state, saved);
    }

    pub fn set_accent(&self, accent: Option<String>) {
        self.state.lock().unwrap().accent = accent;
        self.broadcast();
    }

    pub fn set_resting(&self, resting: std::collections::BTreeMap<String, String>) {
        {
            let mut s = self.state.lock().unwrap();
            if s.resting == resting {
                return;
            }
            log::info!("resting screens: {resting:?}");
            s.resting = resting;
        }
        self.broadcast();
    }

    pub fn set_shortcuts(&self, shortcuts: Vec<String>) {
        self.state.lock().unwrap().shortcuts = shortcuts;
        self.broadcast();
    }

    pub fn set_backend(&self, name: &str) {
        self.state.lock().unwrap().backend = name.into();
        self.broadcast();
    }

    pub fn set_gpu(&self, name: String) {
        self.state.lock().unwrap().gpu = Some(name);
        self.broadcast();
    }

    pub fn reject(&self, monitor: &str, why: String) {
        {
            let mut s = self.state.lock().unwrap();
            break_spans(&mut s.monitors, &[monitor.to_string()]);
            s.monitors.iter_mut().filter(|m| m.name == monitor).for_each(|m| m.wallpaper = None);
        }
        let ev = Event::Error(why);
        self.clients.lock().unwrap().retain_mut(|(_, w)| write_msg(w, &ev).is_ok());
        self.broadcast();
    }

    fn broadcast(&self) {
        let state = self.state.lock().unwrap().clone();
        if let Some(saved) = self.saved.lock().unwrap().as_mut() {
            crate::saved::store(&state, saved);
        }
        let ev = Event::State(Box::new(state));

        self.clients.lock().unwrap().retain_mut(|(_, w)| write_msg(w, &ev).is_ok());
    }

    fn reply(&self, id: u64, ev: &Event) {
        if let Some((_, w)) = self.clients.lock().unwrap().iter_mut().find(|(i, _)| *i == id) {
            let _ = write_msg(w, ev);
        }
    }

    fn handle(&self, req: Request) -> Result<(), String> {
        let mut s = self.state.lock().unwrap();
        let known = |names: &[String], s: &State| names.iter().find(|n| !s.monitors.iter().any(|m| &m.name == *n)).cloned();
        match req {
            Request::GetState => {}
            Request::SetWallpaper { path, monitors } => {
                if let Some(bad) = known(&monitors, &s) {
                    return Err(format!("unknown monitor {bad}"));
                }
                let targets: Vec<String> = s.monitors.iter().map(|m| m.name.clone()).filter(|n| monitors.is_empty() || monitors.contains(n)).collect();
                break_spans(&mut s.monitors, &targets);
                let day = crate::automation::today();
                for t in &targets {
                    s.manual.insert(t.clone(), day.clone());
                }

                for m in s.monitors.iter_mut().filter(|m| targets.contains(&m.name)) {
                    m.wallpaper = Some(path.clone());
                }
            }
            Request::Span { path, monitors } => {
                if monitors.len() < 2 {
                    return Err("a span needs at least two monitors".into());
                }
                if let Some(bad) = known(&monitors, &s) {
                    return Err(format!("unknown monitor {bad}"));
                }

                break_spans(&mut s.monitors, &monitors);
                let day = crate::automation::today();
                for t in &monitors {
                    s.manual.insert(t.clone(), day.clone());
                }
                let group = monitors.join("+");
                for m in s.monitors.iter_mut().filter(|m| monitors.contains(&m.name)) {
                    m.wallpaper = Some(path.clone());
                    m.span = Some(group.clone());
                }
            }
            Request::Clear { monitor } => {
                if let Some(bad) = known(std::slice::from_ref(&monitor), &s) {
                    return Err(format!("unknown monitor {bad}"));
                }
                break_spans(&mut s.monitors, std::slice::from_ref(&monitor));
                s.monitors.iter_mut().filter(|m| m.name == monitor).for_each(|m| m.wallpaper = None);
            }
            Request::Pause => s.paused = PauseReason::User,
            Request::Resume => s.paused = PauseReason::None,
            Request::Next => {
                drop(s);
                crate::automation::next_all(self);
                return Ok(());
            }
            Request::AddToLibrary(mut item) => {
                let previous = s.library.iter().find(|i| i.path == item.path).map(|i| i.added).unwrap_or(0);
                item.added = if previous > 0 { previous } else { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()) };
                s.library.retain(|i| i.path != item.path);

                for w in &mut s.watches {
                    w.ignored.retain(|p| *p != item.path);
                }
                s.library.insert(0, item);
            }
            Request::SetTagList(list) => {
                let mut clean: Vec<String> = Vec::new();
                for t in list.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()) {
                    if !clean.contains(&t) {
                        clean.push(t);
                    }
                }
                s.tag_list = clean;
            }
            Request::SetAlsoLive { path, on } => {
                s.also_live.retain(|p| *p != path);
                if on {
                    s.also_live.push(path);
                }
            }
            Request::SetMeta { path, mut meta } => {
                for f in [&mut meta.title, &mut meta.author, &mut meta.source, &mut meta.notes] {
                    *f = f.trim().to_string();
                }

                if meta.width.is_none_or(|w| w == 0) || meta.height.is_none_or(|h| h == 0) {
                    (meta.width, meta.height) = (None, None);
                }
                if meta.is_empty() {
                    s.meta.remove(&path);
                } else {
                    s.meta.insert(path, meta);
                }
            }
            Request::SetTags { path, tags } => {
                let mut clean: Vec<String> = Vec::new();
                for t in tags.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()) {
                    if !clean.contains(&t) {
                        clean.push(t);
                    }
                }
                s.tags.insert(path, clean);
            }
            Request::RemoveFromLibrary { path } => {
                let from = s.library.iter().find(|i| i.path == path).and_then(|i| i.from_watch.clone());
                if let Some(w) = from.and_then(|id| s.watches.iter_mut().find(|w| w.id == id)) {
                    if !w.ignored.contains(&path) {
                        w.ignored.push(path.clone());
                    }
                }
                forget(&mut s, &path);
            }
            Request::SetWatches(mut list) => {
                let mut seen = std::collections::HashSet::new();
                list.retain(|w| !w.id.is_empty() && !w.path.trim().is_empty() && seen.insert(w.id.clone()));
                for w in &mut list {
                    w.tags = w.tags.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect();
                    w.kinds.retain(|k| matches!(k.as_str(), "photo" | "video" | "web"));
                }

                for item in &mut s.library {
                    if item.from_watch.as_ref().is_some_and(|id| !list.iter().any(|w| &w.id == id)) {
                        item.from_watch = None;
                    }
                }
                s.watch_status.retain(|id, _| list.iter().any(|w| &w.id == id));
                s.watches = list;
                crate::watch::kick();
            }
            Request::RescanWatches => crate::watch::kick(),
            Request::SetArrangement(map) => {
                s.arrangement = map.into_iter().filter(|(n, p)| s.monitors.iter().any(|m| &m.name == n && (m.x, m.y) != (p[0], p[1]))).collect();
            }
            Request::SetWidgets(mut list) => {
                for w in &mut list {
                    w.x = w.x.clamp(0.0, 1.0);
                    w.y = w.y.clamp(0.0, 1.0);
                    w.size = w.size.clamp(0.01, 0.5);
                    w.opacity = w.opacity.clamp(0.05, 1.0);
                    w.weight = w.weight.clamp(100, 900);
                }
                list.retain(|w| !w.id.is_empty());
                s.widgets = list;
            }
            Request::SetBlendLinks(mut links) => {
                for l in links.values_mut() {
                    l.into_a = l.into_a.clamp(0.0, 0.5);
                    l.into_b = l.into_b.clamp(0.0, 0.5);
                    l.strength = l.strength.clamp(0.0, 1.0);
                    for sp in [&mut l.a_span, &mut l.b_span] {
                        sp[0] = sp[0].clamp(0.0, 1.0);
                        sp[1] = sp[1].clamp(sp[0] + 0.02, 1.0).max(sp[0]);
                    }
                }
                s.blend_links = links;
            }
            Request::SetFavourite { path, on } => {
                s.favourites.retain(|p| *p != path);
                if on {
                    s.favourites.push(path);
                }
            }

            Request::MakePreview { .. } | Request::Export { .. } | Request::Import { .. } | Request::MakeLoop { .. } => {}
            Request::SetSettings(new) => {
                s.settings = Settings {
                    fps_cap: new.fps_cap.clamp(5, 240),
                    quality: new.quality.clamp(0.25, 1.0),
                    volume: new.volume.min(100),
                    pause_idle_minutes: new.pause_idle_minutes.min(240),
                    ..new
                };
            }
            Request::SetCollections(mut cols) => {
                for c in &mut cols {
                    c.name = c.name.trim().to_string();
                    let mut seen = std::collections::HashSet::new();
                    c.paths.retain(|p| seen.insert(p.clone()));
                }
                cols.retain(|c| !c.id.is_empty() && !c.name.is_empty());
                s.collections = cols;
            }
            Request::SetAutomations(mut list) => {
                let mut seen = std::collections::HashSet::new();
                list.retain(|a| !a.id.is_empty() && seen.insert(a.id.clone()));
                for a in &mut list {
                    a.name = a.name.trim().to_string();
                    a.days.retain(|d| *d < 7);
                    a.days.sort_unstable();
                    a.days.dedup();
                    if let zwall_ipc::Trigger::Every { minutes, .. } = &mut a.trigger {
                        *minutes = (*minutes).clamp(1, 7 * 24 * 60);
                    }
                }
                crate::automation::changed(&s.automations, &list);
                s.automation_runs.retain(|id, _| list.iter().any(|a| &a.id == id));
                s.automations = list;
            }
            Request::RunAutomation { id } => {
                drop(s);
                crate::automation::run_now(self, &id);
                return Ok(());
            }
            Request::ClearManual => s.manual.clear(),

            Request::Quit => self.request_quit(),
            Request::ClearParams { path } => {
                s.params.remove(&path);
            }
            Request::SetParams { path, params } => {
                let clamp = Params {
                    speed: params.speed.clamp(0.0, 3.0),
                    intensity: params.intensity.clamp(0.0, 1.5),
                    depth: params.depth.clamp(0.0, 2.0),
                    volume: params.volume.clamp(0.0, 1.0),
                    overlay_amount: params.overlay_amount.clamp(0.0, 1.5),
                    life: params.life.clamp(0.0, 1.5),
                    ..params
                };

                if clamp == Params::default() && !path.contains(zwall_ipc::SCREEN_KEY) {
                    s.params.remove(&path);
                } else {
                    s.params.insert(path, clamp);
                }
            }
        }
        Ok(())
    }
}

fn break_spans(monitors: &mut [Monitor], names: &[String]) {
    let groups: Vec<String> = monitors.iter().filter(|m| names.contains(&m.name)).filter_map(|m| m.span.clone()).collect();
    for m in monitors.iter_mut().filter(|m| m.span.as_ref().is_some_and(|g| groups.contains(g))) {
        m.span = None;
    }
}

pub fn bind() -> anyhow::Result<transport::Server> {
    let server = transport::Server::bind()?;
    log::info!("listening on {}", zwall_ipc::socket_path().display());
    Ok(server)
}

pub fn serve(server: transport::Server, hub: Arc<Hub>) {
    for id in 0.. {
        let (r, mut w) = match server.accept() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("accept: {e}");
                continue;
            }
        };
        let hub = hub.clone();
        thread::spawn(move || {
            let first = Event::State(Box::new(hub.state.lock().unwrap().clone()));
            if write_msg(&mut w, &first).is_err() {
                return;
            }
            hub.clients.lock().unwrap().push((id, w));
            let mut r = BufReader::new(r);
            let mut buf = String::new();
            loop {
                match read_msg::<_, Request>(&mut r, &mut buf) {
                    Ok(Some(Request::MakePreview { path })) => crate::previews::request(hub.clone(), path),
                    Ok(Some(Request::Export { path, name })) => crate::share::export(hub.clone(), path, name),
                    Ok(Some(Request::Import { file })) => crate::share::import(hub.clone(), file),
                    Ok(Some(Request::MakeLoop { path, start, end, crossfade, find_best })) => crate::looper::make(hub.clone(), path, start, end, crossfade, find_best),
                    Ok(Some(req)) => match hub.handle(req) {
                        Ok(()) => hub.broadcast(),
                        Err(e) => hub.reply(id, &Event::Error(e)),
                    },
                    Ok(None) => break,
                    Err(e) => hub.reply(id, &Event::Error(e.to_string())),
                }
            }
            hub.clients.lock().unwrap().retain(|(i, _)| *i != id);
        });
    }
}

fn forget(s: &mut State, path: &str) {
    s.library.retain(|i| i.path != path);
    s.tags.remove(path);
    s.meta.remove(path);
    s.facts.remove(path);
    s.params.retain(|k, _| zwall_ipc::key_path(k) != path);
    for c in &mut s.collections {
        c.paths.retain(|p| p != path);
    }
    s.also_live.retain(|p| p != path);
    s.favourites.retain(|p| p != path);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hub() -> Hub {
        let mon = |name: &str, x| Monitor { name: name.into(), x, y: 0, width: 100, height: 100, scale: 1.0, primary: x == 0, wallpaper: None, span: None };
        Hub::new(State { monitors: vec![mon("A", 0), mon("B", 100), mon("C", 200)], ..Default::default() })
    }

    fn spans(h: &Hub) -> Vec<Option<String>> {
        h.state.lock().unwrap().monitors.iter().map(|m| m.span.clone()).collect()
    }

    #[test]
    fn set_on_one_member_dissolves_the_span() {
        let h = hub();
        h.handle(Request::Span { path: "p".into(), monitors: vec!["A".into(), "B".into()] }).unwrap();
        assert_eq!(spans(&h), [Some("A+B".into()), Some("A+B".into()), None]);
        h.handle(Request::SetWallpaper { path: "q".into(), monitors: vec!["A".into()] }).unwrap();
        assert_eq!(spans(&h), [None, None, None]);
        assert_eq!(h.state.lock().unwrap().monitors[1].wallpaper.as_deref(), Some("p"));
    }

    #[test]
    fn respan_overlapping_breaks_old_group() {
        let h = hub();
        h.handle(Request::Span { path: "p".into(), monitors: vec!["A".into(), "B".into()] }).unwrap();
        h.handle(Request::Span { path: "q".into(), monitors: vec!["B".into(), "C".into()] }).unwrap();
        assert_eq!(spans(&h), [None, Some("B+C".into()), Some("B+C".into())]);
    }

    #[test]
    fn rejects_unknown_and_single_span() {
        let h = hub();
        assert!(h.handle(Request::Clear { monitor: "Z".into() }).is_err());
        assert!(h.handle(Request::Span { path: "p".into(), monitors: vec!["A".into()] }).is_err());
    }
}
