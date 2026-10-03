

use crate::server::Hub;
use chrono::{Datelike, Local, NaiveDate, Timelike};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use zwall_ipc::{Action, Automation, PauseReason, Request, Source, State, Trigger};


#[derive(Default)]
struct Undo {

    screens: Vec<(String, Option<String>, String)>,
    paused: Option<PauseReason>,
    mute: Option<bool>,
    volume: Option<u32>,
}

#[derive(Default)]
struct Run {
    started: bool,
    last: Option<Instant>,

    fired: HashMap<String, (NaiveDate, String)>,

    due: HashMap<String, Instant>,

    running: HashMap<String, bool>,
    battery: Option<bool>,
    undo: HashMap<String, Undo>,
}

static RUN: Mutex<Option<Run>> = Mutex::new(None);


pub fn minutes(at: &str) -> Option<u32> {
    let (h, m) = at.split_once(':')?;
    let (h, m): (u32, u32) = (h.trim().parse().ok()?, m.trim().parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

pub fn today() -> String {
    Local::now().date_naive().to_string()
}


fn in_window(from: &str, to: &str, now: u32) -> bool {
    match (minutes(from), minutes(to)) {
        (Some(a), Some(b)) if a <= b => (a..b).contains(&now),
        (Some(a), Some(b)) => now >= a || now < b,
        _ => true,
    }
}

fn runs_today(a: &Automation, weekday: u8) -> bool {
    a.enabled && (a.days.is_empty() || a.days.contains(&weekday))
}


fn changes_wallpaper(a: &Action) -> bool {
    matches!(a, Action::Play { .. } | Action::Random { .. } | Action::Next { .. })
}

fn everything(s: &State) -> Vec<String> {
    let mut all: Vec<String> = s.library.iter().map(|i| i.path.clone()).collect();
    all.extend(zwall_render::PRESETS.iter().map(|(n, _)| format!("preset://{n}")));
    all
}


pub fn pool(s: &State, src: &Source) -> Vec<String> {
    let exists = |p: &String| p.starts_with("preset://") || s.library.iter().any(|i| &i.path == p);
    let list: Vec<String> = match src {
        Source::Everything => everything(s),
        Source::Favourites => s.favourites.clone(),
        Source::Collection { id } => s.collections.iter().find(|c| &c.id == id).map(|c| c.paths.clone()).unwrap_or_default(),
        Source::Tag { tag, builtin } => everything(s)
            .into_iter()
            .filter(|p| match s.tags.get(p) {
                Some(t) => t.contains(tag),
                None => builtin.contains(p),
            })
            .collect(),
        Source::Kind { kind } => match kind.as_str() {
            "shader" => zwall_render::PRESETS.iter().map(|(n, _)| format!("preset://{n}")).chain(s.also_live.iter().cloned()).collect(),
            k => s.library.iter().filter(|i| i.kind == k).map(|i| i.path.clone()).collect(),
        },
        Source::List { paths, .. } => paths.clone(),
    };
    let list: Vec<String> = list.into_iter().filter(exists).collect();
    if !list.is_empty() {
        return list;
    }
    if !s.favourites.is_empty() && !matches!(src, Source::Favourites) {
        return s.favourites.clone();
    }
    everything(s)
}

fn random_index(n: usize) -> usize {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);

    let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((z ^ (z >> 31)) % n as u64) as usize
}


pub fn pick(pool: &[String], current: Option<&str>, shuffle: bool) -> Option<String> {
    if pool.is_empty() {
        return None;
    }
    let i = current.and_then(|c| pool.iter().position(|p| p == c));
    if shuffle && pool.len() > 1 {
        let mut j = random_index(pool.len());
        if Some(j) == i {
            j = (j + 1) % pool.len();
        }
        return Some(pool[j].clone());
    }
    Some(pool[i.map_or(0, |i| (i + 1) % pool.len())].clone())
}


fn targets(s: &State, a: &Automation) -> Vec<String> {
    let day = today();
    s.monitors
        .iter()
        .map(|m| m.name.clone())
        .filter(|n| a.screens.is_empty() || a.screens.contains(n))
        .filter(|n| !(a.respect_manual && changes_wallpaper(&a.action) && s.manual.get(n) == Some(&day)))
        .collect()
}


fn perform(hub: &Hub, a: &Automation) -> Option<Undo> {
    let s = hub.snapshot();
    let mut undo = Undo::default();
    match &a.action {
        Action::Play { .. } | Action::Random { .. } | Action::Next { .. } => {
            let screens = targets(&s, a);
            if screens.is_empty() {
                return None;
            }
            let showing = |n: &str| s.monitors.iter().find(|m| m.name == n).and_then(|m| m.wallpaper.clone());
            let shared = match &a.action {
                Action::Play { path } => Some(path.clone()),
                Action::Random { source, same_everywhere: true } => pick(&pool(&s, source), showing(&screens[0]).as_deref(), true),
                _ => None,
            };
            let mut done: Vec<String> = Vec::new();
            for n in &screens {

                let span = s.monitors.iter().find(|m| &m.name == n).and_then(|m| m.span.clone());
                if span.as_ref().is_some_and(|g| done.iter().any(|d| s.monitors.iter().any(|m| &m.name == d && m.span.as_ref() == Some(g)))) {
                    continue;
                }
                let before = showing(n);
                let next = shared.clone().or_else(|| match &a.action {
                    Action::Random { source, .. } => pick(&pool(&s, source), before.as_deref(), true),
                    Action::Next { source } => pick(&pool(&s, source), before.as_deref(), false),
                    _ => None,
                });
                let Some(next) = next else { continue };
                if before.as_deref() != Some(next.as_str()) {
                    log::info!("{n}: {next} (automation {})", a.id);
                    hub.set_auto(n, next.clone());
                    undo.screens.push((n.clone(), before, next));
                }
                done.push(n.clone());
            }
            if undo.screens.is_empty() {
                return None;
            }
        }
        Action::Pause | Action::Resume => {
            let want = if matches!(a.action, Action::Pause) { PauseReason::User } else { PauseReason::None };
            if s.paused == want {
                return None;
            }
            undo.paused = Some(s.paused);
            hub.request(if want == PauseReason::User { Request::Pause } else { Request::Resume });
        }
        Action::Mute | Action::Unmute | Action::Volume { .. } => {
            let mut set = s.settings.clone();
            match a.action {
                Action::Mute => set.mute = true,
                Action::Unmute => set.mute = false,
                Action::Volume { level } => (set.volume, set.mute) = (level.min(100), false),
                _ => {}
            }
            if set == s.settings {
                return None;
            }
            (undo.mute, undo.volume) = (Some(s.settings.mute), Some(s.settings.volume));
            hub.request(Request::SetSettings(set));
        }
    }
    hub.mark_run(&a.id);
    Some(undo)
}


fn revert(hub: &Hub, undo: Undo) {
    let s = hub.snapshot();
    for (n, before, ours) in undo.screens {
        let now = s.monitors.iter().find(|m| m.name == n).and_then(|m| m.wallpaper.clone());
        if now.as_deref() == Some(ours.as_str()) {
            match before {
                Some(p) => hub.set_auto(&n, p),
                None => hub.request(Request::Clear { monitor: n }),
            }
        }
    }
    if let Some(p) = undo.paused {
        hub.request(if p == PauseReason::None { Request::Resume } else { Request::Pause });
    }
    if undo.mute.is_some() || undo.volume.is_some() {
        let mut set = s.settings.clone();
        set.mute = undo.mute.unwrap_or(set.mute);
        set.volume = undo.volume.unwrap_or(set.volume);
        hub.request(Request::SetSettings(set));
    }
}


pub fn changed(old: &[Automation], new: &[Automation]) {
    let mut run = RUN.lock().unwrap();
    let run = run.get_or_insert_with(Run::default);
    let t = Local::now();
    let now = t.hour() * 60 + t.minute();
    for a in new {
        let before = old.iter().find(|o| o.id == a.id);
        if let Trigger::At { time } = &a.trigger {
            if minutes(time).is_some_and(|m| m <= now) {
                run.fired.insert(a.id.clone(), (t.date_naive(), time.clone()));
            }
        }
        if before.is_none_or(|b| b.trigger != a.trigger || b.enabled != a.enabled) {
            run.due.remove(&a.id);
        }
    }
    run.undo.retain(|id, _| new.iter().any(|a| &a.id == id));
}


pub fn tick(hub: &Hub) {
    let mut guard = RUN.lock().unwrap();
    let run = guard.get_or_insert_with(Run::default);
    if run.last.is_some_and(|t| t.elapsed() < Duration::from_secs(2)) {
        return;
    }
    run.last = Some(Instant::now());
    let s = hub.snapshot();
    let starting = !run.started;
    run.started = true;
    if s.automations.iter().all(|a| !a.enabled) {
        return;
    }
    let t = Local::now();
    let (date, now, weekday) = (t.date_naive(), t.hour() * 60 + t.minute(), t.weekday().num_days_from_monday() as u8);
    let mut fire: Vec<&Automation> = Vec::new();
    let mut put_back: Vec<String> = Vec::new();


    let mut at: Vec<(&Automation, u32)> = s
        .automations
        .iter()
        .filter(|a| runs_today(a, weekday))
        .filter_map(|a| match &a.trigger {
            Trigger::At { time } => minutes(time).filter(|m| *m <= now && run.fired.get(&a.id) != Some(&(date, time.clone()))).map(|m| (a, m)),
            _ => None,
        })
        .collect();
    at.sort_by_key(|(_, m)| std::cmp::Reverse(*m));
    let mut covered: Vec<Vec<String>> = Vec::new();
    for (a, m) in at {
        if let Trigger::At { time } = &a.trigger {
            run.fired.insert(a.id.clone(), (date, time.clone()));
        }
        let fresh = now - m <= 2;
        if changes_wallpaper(&a.action) {
            if (fresh || starting) && !covered.contains(&a.screens) {
                covered.push(a.screens.clone());
                fire.push(a);
            }
        } else if fresh {
            fire.push(a);
        }
    }


    let paused = s.paused != PauseReason::None;
    let instant = Instant::now();
    for a in s.automations.iter().filter(|a| a.enabled) {
        if let Trigger::Every { minutes: every, from, to } = &a.trigger {
            let period = Duration::from_secs((*every).clamp(1, 7 * 24 * 60) as u64 * 60);
            let due = *run.due.entry(a.id.clone()).or_insert(instant + period);
            if instant >= due && !paused && runs_today(a, weekday) && in_window(from, to, now) {
                run.due.insert(a.id.clone(), instant + period);
                fire.push(a);
            }
        }
    }


    let watched: Vec<&Automation> = s.automations.iter().filter(|a| a.enabled && matches!(a.trigger, Trigger::AppOpens { .. })).collect();
    if !watched.is_empty() {

        let names = crate::desktop::running_names();
        for a in watched {
            let Trigger::AppOpens { app } = &a.trigger else { continue };
            let app = app.trim().to_lowercase();
            let app = app.strip_suffix(".exe").unwrap_or(&app);
            let up = !app.is_empty() && names.iter().any(|n| n.starts_with(app));
            let was = run.running.insert(a.id.clone(), up);
            match (was, up) {
                (Some(false), true) if runs_today(a, weekday) => fire.push(a),
                (Some(true), false) => put_back.push(a.id.clone()),
                _ => {}
            }
        }
    }


    if s.automations.iter().any(|a| a.enabled && matches!(a.trigger, Trigger::OnBattery | Trigger::PluggedIn)) {
        let battery = crate::desktop::on_battery();
        if let Some(was) = run.battery.replace(battery) {
            if was != battery {
                for a in s.automations.iter().filter(|a| a.enabled) {
                    let starts = matches!((&a.trigger, battery), (Trigger::OnBattery, true) | (Trigger::PluggedIn, false));
                    let ends = matches!((&a.trigger, battery), (Trigger::OnBattery, false) | (Trigger::PluggedIn, true));
                    if starts && runs_today(a, weekday) {
                        fire.push(a);
                    } else if ends {
                        put_back.push(a.id.clone());
                    }
                }
            }
        }
    }

    if starting {
        fire.extend(s.automations.iter().filter(|a| matches!(a.trigger, Trigger::Startup) && runs_today(a, weekday)));
    }

    let undo_wanted: Vec<String> = s.automations.iter().filter(|a| a.undo_after).map(|a| a.id.clone()).collect();
    let reverts: Vec<Undo> = put_back.iter().filter_map(|id| run.undo.remove(id)).collect();
    drop(guard);
    for u in reverts {
        revert(hub, u);
    }
    let mut keep = Vec::new();
    for a in fire {
        if let Some(u) = perform(hub, a) {
            if undo_wanted.contains(&a.id) {
                keep.push((a.id.clone(), u));
            }
        }
    }
    if !keep.is_empty() {
        RUN.lock().unwrap().get_or_insert_with(Run::default).undo.extend(keep);
    }
}


pub fn run_now(hub: &Hub, id: &str) {
    let s = hub.snapshot();
    if let Some(a) = s.automations.iter().find(|a| a.id == id) {

        let a = Automation { respect_manual: false, ..a.clone() };
        perform(hub, &a);
    }
}


pub fn next_all(hub: &Hub) {
    let s = hub.snapshot();
    let cycling: Vec<&Automation> = s.automations.iter().filter(|a| a.enabled && matches!(a.trigger, Trigger::Every { .. }) && changes_wallpaper(&a.action)).collect();
    if !cycling.is_empty() {
        for a in cycling {
            perform(hub, &Automation { respect_manual: false, ..a.clone() });
            RUN.lock().unwrap().get_or_insert_with(Run::default).due.remove(&a.id);
        }
        return;
    }
    let a = Automation {
        id: "next".into(),
        name: String::new(),
        enabled: true,
        trigger: Trigger::Startup,
        action: Action::Next { source: Source::Favourites },
        days: vec![],
        screens: s.monitors.iter().filter(|m| m.wallpaper.is_some()).map(|m| m.name.clone()).collect(),
        respect_manual: false,
        undo_after: false,
    };
    if !a.screens.is_empty() {
        perform(hub, &a);
    }
}


pub fn migrate(rotation: &std::collections::BTreeMap<String, zwall_ipc::Rotation>, schedules: &std::collections::BTreeMap<String, Vec<zwall_ipc::Slot>>) -> Vec<Automation> {
    let mut out = Vec::new();
    for (monitor, r) in rotation {
        let source = match r.source.as_str() {
            "everything" => Source::Everything,
            "list" => Source::List { paths: r.list.clone(), label: r.label.clone() },
            _ => Source::Favourites,
        };
        out.push(Automation {
            id: format!("rot-{monitor}"),
            name: String::new(),
            enabled: true,
            trigger: Trigger::Every { minutes: r.every_minutes, from: String::new(), to: String::new() },
            action: if r.shuffle { Action::Random { source, same_everywhere: true } } else { Action::Next { source } },
            days: vec![],
            screens: vec![monitor.clone()],
            respect_manual: false,
            undo_after: false,
        });
    }
    for (monitor, slots) in schedules {
        for (i, slot) in slots.iter().enumerate() {
            out.push(Automation {
                id: format!("sch-{monitor}-{i}"),
                name: String::new(),
                enabled: true,
                trigger: Trigger::At { time: slot.at.clone() },
                action: Action::Play { path: slot.path.clone() },
                days: vec![],
                screens: vec![monitor.clone()],
                respect_manual: false,
                undo_after: false,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use zwall_ipc::{LibraryItem, UserCollection};

    #[test]
    fn picks_in_order_and_wraps() {
        let pool = vec!["a".to_string(), "b".into(), "c".into()];
        assert_eq!(pick(&pool, Some("a"), false).as_deref(), Some("b"));
        assert_eq!(pick(&pool, Some("c"), false).as_deref(), Some("a"));
        assert_eq!(pick(&pool, None, false).as_deref(), Some("a"));
        for _ in 0..20 {
            assert_ne!(pick(&pool, Some("b"), true).as_deref(), Some("b"));
        }
        assert_eq!(pick(&[], None, false), None);
    }

    #[test]
    fn sources_and_fallbacks() {
        let item = |p: &str, k: &str| LibraryItem { path: p.into(), name: p.into(), kind: k.into(), added: 0, from_watch: None };
        let mut s = State { library: vec![item("/a.jpg", "photo"), item("/b.mp4", "video")], favourites: vec!["/a.jpg".into()], ..Default::default() };
        s.collections = vec![UserCollection { id: "c".into(), name: "C".into(), paths: vec!["/b.mp4".into(), "/gone.jpg".into()] }];
        assert_eq!(pool(&s, &Source::Collection { id: "c".into() }), vec!["/b.mp4".to_string()]);
        assert_eq!(pool(&s, &Source::Kind { kind: "photo".into() }), vec!["/a.jpg".to_string()]);

        s.collections[0].paths.clear();
        assert_eq!(pool(&s, &Source::Collection { id: "c".into() }), vec!["/a.jpg".to_string()]);

        s.tags.insert("/b.mp4".into(), vec!["night".into()]);
        let night = pool(&s, &Source::Tag { tag: "night".into(), builtin: vec!["preset://aurora".into()] });
        assert!(night.contains(&"/b.mp4".to_string()) && night.contains(&"preset://aurora".to_string()));
    }

    #[test]
    fn windows_and_times() {
        assert_eq!(minutes("7:05"), Some(425));
        assert_eq!(minutes("25:00"), None);
        assert!(in_window("09:00", "17:00", 12 * 60));
        assert!(!in_window("09:00", "17:00", 18 * 60));
        assert!(in_window("22:00", "06:00", 23 * 60) && in_window("22:00", "06:00", 60));
        assert!(in_window("", "", 5));
    }

    #[test]
    fn old_rotation_and_schedules_become_automations() {
        let mut rot = std::collections::BTreeMap::new();
        rot.insert("DP-1".to_string(), zwall_ipc::Rotation { every_minutes: 30, source: "favourites".into(), shuffle: true, list: vec![], label: String::new() });
        let mut sch = std::collections::BTreeMap::new();
        sch.insert("DP-3".to_string(), vec![zwall_ipc::Slot { at: "07:00".into(), path: "/day.jpg".into() }]);
        let a = migrate(&rot, &sch);
        assert_eq!(a.len(), 2);
        assert!(matches!(a[0].trigger, Trigger::Every { minutes: 30, .. }) && matches!(a[0].action, Action::Random { .. }));
        assert!(matches!(&a[1].action, Action::Play { path } if path == "/day.jpg") && a[1].screens == vec!["DP-3".to_string()]);
    }
}
