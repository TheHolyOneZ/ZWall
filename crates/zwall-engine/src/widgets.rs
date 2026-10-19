use std::time::Instant;

pub fn fonts() -> Vec<String> {
    #[cfg(not(windows))]
    {
        let Ok(out) = crate::desktop::command("fc-list").args([":", "family"]).output() else { return Vec::new() };
        let mut list: Vec<String> = String::from_utf8_lossy(&out.stdout)
            .lines()

            .filter_map(|l| l.split(',').next())
            .map(|f| f.trim().replace("\\-", "-"))
            .filter(|f| !f.is_empty() && !f.starts_with('.'))
            .collect();
        list.sort_by_key(|f| f.to_lowercase());
        list.dedup();
        list
    }
    #[cfg(windows)]
    {
        Vec::new()
    }
}

pub struct Stats {
    last_cpu: Option<(u64, u64)>,
    last: Option<Instant>,
}

impl Stats {
    pub fn new() -> Self {
        Self { last_cpu: None, last: None }
    }

    pub fn sample(&mut self) -> Option<serde_json::Value> {
        if self.last.is_some_and(|t| t.elapsed().as_secs_f32() < 2.0) {
            return None;
        }
        self.last = Some(Instant::now());
        let cpu = self.cpu();
        let (ram_used, ram_total) = ram().unwrap_or((0, 0));
        let uptime = std::fs::read_to_string("/proc/uptime").ok().and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok()).unwrap_or(0.0);
        let (battery, charging) = battery().map_or((serde_json::Value::Null, false), |(p, c)| (p.into(), c));
        Some(serde_json::json!({ "t": "stats", "cpu": cpu, "ramUsed": ram_used, "ramTotal": ram_total, "uptime": uptime as u64, "battery": battery, "charging": charging }))
    }

    fn cpu(&mut self) -> u32 {
        let Some(line) = std::fs::read_to_string("/proc/stat").ok().and_then(|s| s.lines().next().map(String::from)) else { return 0 };
        let v: Vec<u64> = line.split_whitespace().skip(1).filter_map(|x| x.parse().ok()).collect();
        if v.len() < 4 {
            return 0;
        }
        let idle = v[3] + v.get(4).copied().unwrap_or(0);
        let total: u64 = v.iter().sum();
        let pct = match self.last_cpu {
            Some((t0, i0)) if total > t0 => (100 * (total - t0 - (idle - i0).min(total - t0)) / (total - t0)) as u32,
            _ => 0,
        };
        self.last_cpu = Some((total, idle));
        pct
    }
}

fn ram() -> Option<(u64, u64)> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let get = |k: &str| text.lines().find(|l| l.starts_with(k))?.split_whitespace().nth(1)?.parse::<u64>().ok();
    let (total, avail) = (get("MemTotal:")?, get("MemAvailable:")?);
    Some(((total - avail) / 1024, total / 1024))
}

fn battery() -> Option<(u32, bool)> {
    let dir = std::fs::read_dir("/sys/class/power_supply").ok()?.flatten().map(|e| e.path()).find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("BAT")))?;
    let pct = std::fs::read_to_string(dir.join("capacity")).ok()?.trim().parse().ok()?;
    let charging = std::fs::read_to_string(dir.join("status")).is_ok_and(|s| s.trim() == "Charging" || s.trim() == "Full");
    Some((pct, charging))
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_this_machine() {
        if cfg!(target_os = "linux") {
            let (used, total) = super::ram().unwrap();
            assert!(total > 0 && used <= total);
        }
    }
}
