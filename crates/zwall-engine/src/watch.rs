use crate::server::Hub;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use zwall_format::scan::Found;

const EVERY: Duration = Duration::from_secs(30);

const MAX: usize = 20_000;

static KICK: AtomicBool = AtomicBool::new(true);

pub fn kick() {
    KICK.store(true, Ordering::Relaxed);
}

pub struct Scan {
    pub id: String,
    pub found: Vec<Found>,
    pub error: Option<String>,
}

pub fn wanted(w: &zwall_ipc::Watch, f: &Found) -> bool {
    f.skip.is_none() && matches!(f.kind, "photo" | "video" | "web") && (w.kinds.is_empty() || w.kinds.iter().any(|k| k == f.kind))
}

pub fn run(hub: Arc<Hub>) {
    let mut last: Option<Instant> = None;
    while !hub.quitting() {
        let due = last.is_none_or(|t| t.elapsed() >= EVERY);
        if KICK.swap(false, Ordering::Relaxed) || due {
            last = Some(Instant::now());
            let watches = hub.snapshot().watches;
            let results: Vec<Scan> = watches
                .iter()
                .filter(|w| w.enabled)
                .map(|w| match zwall_format::scan::scan(Path::new(&w.path), w.recursive, MAX) {
                    Ok(all) => Scan { id: w.id.clone(), found: all.into_iter().filter(|f| wanted(w, f)).collect(), error: None },
                    Err(e) => Scan { id: w.id.clone(), found: Vec::new(), error: Some(if Path::new(&w.path).exists() { e } else { "The folder isn't there (moved, or on a drive that isn't plugged in)".into() }) },
                })
                .collect();
            if !results.is_empty() {
                hub.apply_watch(results);
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_pick_kinds() {
        let w = zwall_ipc::Watch { id: "w".into(), path: "/x".into(), enabled: true, recursive: true, kinds: vec!["video".into()], collection: None, tags: vec![], prune: true, ignored: vec![] };
        let f = |kind: &'static str| Found { path: "/x/a".into(), name: "a".into(), kind, folder: String::new(), bytes: 0, tags: vec![], skip: None, source: None };
        assert!(wanted(&w, &f("video")));
        assert!(!wanted(&w, &f("photo")));
        assert!(!wanted(&w, &f("zwall")));
        let all = zwall_ipc::Watch { kinds: vec![], ..w };
        assert!(wanted(&all, &f("web")) && wanted(&all, &f("photo")));
    }
}
