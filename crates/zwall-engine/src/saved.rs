use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};
use zwall_ipc::State;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Saved {
    pub monitors: BTreeMap<String, SavedMonitor>,
    pub settings: Option<zwall_ipc::Settings>,
    pub user_paused: bool,
    pub params: BTreeMap<String, zwall_ipc::Params>,
    pub library: Vec<zwall_ipc::LibraryItem>,
    pub tags: BTreeMap<String, Vec<String>>,

    pub schedules: BTreeMap<String, Vec<zwall_ipc::Slot>>,
    pub automations: Vec<zwall_ipc::Automation>,
    pub manual: BTreeMap<String, String>,
    pub automation_runs: BTreeMap<String, u64>,
    pub collections: Vec<zwall_ipc::UserCollection>,
    pub tag_list: Vec<String>,
    pub also_live: Vec<String>,
    pub favourites: Vec<String>,
    pub meta: BTreeMap<String, zwall_ipc::Meta>,
    pub watches: Vec<zwall_ipc::Watch>,
    pub widgets: Vec<zwall_ipc::Widget>,
    pub arrangement: BTreeMap<String, [i32; 2]>,
    pub blend_links: BTreeMap<String, zwall_ipc::BlendLink>,

    pub plasma: BTreeMap<String, crate::plasma::Original>,

    pub rotation: BTreeMap<String, zwall_ipc::Rotation>,

    pub accent_original: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SavedMonitor {
    pub wallpaper: Option<String>,
    pub span: Option<String>,
}

fn path() -> Option<PathBuf> {
    Some(crate::desktop::config_dir()?.join("engine.json"))
}

pub fn load() -> Saved {
    let Some(p) = path() else { return Saved::default() };
    match std::fs::read(&p) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            log::warn!("ignoring unreadable {}: {e}", p.display());
            Saved::default()
        }),
        Err(_) => Saved::default(),
    }
}

pub fn apply(saved: &Saved, state: &mut State) {
    let present: Vec<String> = state.monitors.iter().map(|m| m.name.clone()).collect();

    let resume = saved.settings.as_ref().is_none_or(|s| s.resume);
    for m in state.monitors.iter_mut().filter(|_| resume) {
        if let Some(s) = saved.monitors.get(&m.name) {
            m.wallpaper = s.wallpaper.clone();
            m.span = s.span.clone().filter(|g| g.split('+').all(|n| present.iter().any(|p| p == n)));
        }
    }
    if let Some(settings) = &saved.settings {
        state.settings = settings.clone();
    }
    state.automations = if saved.automations.is_empty() { crate::automation::migrate(&saved.rotation, &saved.schedules) } else { saved.automations.clone() };
    state.manual = saved.manual.clone();
    state.automation_runs = saved.automation_runs.clone();
    state.params = saved.params.clone();
    state.library = saved.library.clone();
    state.tags = saved.tags.clone();
    state.collections = saved.collections.clone();
    state.tag_list = saved.tag_list.clone();
    state.also_live = saved.also_live.clone();
    state.favourites = saved.favourites.clone();
    state.meta = saved.meta.clone();
    state.watches = saved.watches.clone();
    state.widgets = saved.widgets.clone();
    state.arrangement = saved.arrangement.clone();
    state.blend_links = saved.blend_links.clone();
    if saved.user_paused {
        state.paused = zwall_ipc::PauseReason::User;
    }
}

pub fn store(state: &State, previous: &mut Saved) {
    for m in &state.monitors {
        previous.monitors.insert(m.name.clone(), SavedMonitor { wallpaper: m.wallpaper.clone(), span: m.span.clone() });
    }
    previous.settings = Some(state.settings.clone());
    previous.rotation.clear();
    previous.schedules.clear();
    previous.automations = state.automations.clone();
    previous.manual = state.manual.clone();
    previous.automation_runs = state.automation_runs.clone();
    previous.user_paused = state.paused == zwall_ipc::PauseReason::User;
    previous.params = state.params.clone();
    previous.library = state.library.clone();
    previous.tags = state.tags.clone();
    previous.collections = state.collections.clone();
    previous.tag_list = state.tag_list.clone();
    previous.also_live = state.also_live.clone();
    previous.favourites = state.favourites.clone();
    previous.meta = state.meta.clone();
    previous.watches = state.watches.clone();
    previous.widgets = state.widgets.clone();
    previous.arrangement = state.arrangement.clone();
    previous.blend_links = state.blend_links.clone();
    let Some(p) = path() else { return };
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(p.parent().unwrap())?;
        let tmp = p.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(previous)?)?;
        std::fs::rename(tmp, &p)
    };
    if let Err(e) = write() {
        log::warn!("could not save {}: {e}", p.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zwall_ipc::Monitor;

    #[test]
    fn span_needs_all_members() {
        let mon = |n: &str| Monitor { name: n.into(), x: 0, y: 0, width: 1, height: 1, scale: 1.0, primary: false, wallpaper: None, span: None };
        let mut state = State { monitors: vec![mon("A")], ..Default::default() };
        let saved = Saved {
            monitors: BTreeMap::from([("A".into(), SavedMonitor { wallpaper: Some("p".into()), span: Some("A+B".into()) })]),
            ..Default::default()
        };
        apply(&saved, &mut state);
        assert_eq!(state.monitors[0].wallpaper.as_deref(), Some("p"));
        assert_eq!(state.monitors[0].span, None);
    }
}
