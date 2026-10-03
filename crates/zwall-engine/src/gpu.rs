

use std::{collections::HashMap, time::Instant};

pub struct Meter {
    last: Option<(Instant, u64)>,
}

fn pids_named(name: &str) -> Vec<u32> {
    let Ok(dir) = std::fs::read_dir("/proc") else { return Vec::new() };
    dir.flatten()
        .filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok())
        .filter(|pid| std::fs::read_to_string(format!("/proc/{pid}/comm")).is_ok_and(|c| c.trim() == name))
        .collect()
}


fn busy_ns(pids: &[u32]) -> u64 {
    let mut clients: HashMap<String, u64> = HashMap::new();
    for pid in pids {
        let Ok(dir) = std::fs::read_dir(format!("/proc/{pid}/fdinfo")) else { continue };
        for e in dir.flatten() {
            let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
            let mut id = None;
            let mut ns = 0u64;
            for line in text.lines() {
                if let Some(v) = line.strip_prefix("drm-client-id:") {
                    id = Some(format!("{pid}:{}", v.trim()));
                } else if let Some(rest) = line.strip_prefix("drm-engine-") {
                    if let Some((_, v)) = rest.split_once(':') {
                        ns += v.trim().trim_end_matches("ns").trim().parse::<u64>().unwrap_or(0);
                    }
                }
            }
            if let Some(id) = id {
                let slot = clients.entry(id).or_default();
                *slot = (*slot).max(ns);
            }
        }
    }
    clients.values().sum()
}

impl Meter {
    pub fn new() -> Self {
        Self { last: None }
    }


    pub fn sample(&mut self, include_plasma: bool) -> Option<f32> {
        let mut pids = vec![std::process::id()];
        if include_plasma {
            pids.extend(pids_named("plasmashell"));
        }
        let now = Instant::now();
        let ns = busy_ns(&pids);
        let prev = self.last.replace((now, ns));
        let (t0, ns0) = prev?;
        let elapsed = now.duration_since(t0).as_nanos() as f64;
        (ns > 0 && elapsed > 0.0).then(|| ((ns.saturating_sub(ns0)) as f64 / elapsed * 100.0).clamp(0.0, 100.0) as f32)
    }
}
