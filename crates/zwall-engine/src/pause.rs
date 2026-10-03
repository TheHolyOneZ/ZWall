

use zwall_ipc::{PauseReason, Settings};


pub struct Signals {
    pub fullscreen: bool,
    pub idle_ms: u64,
    pub on_battery: bool,

    pub app_running: bool,
    pub locked: bool,
}

pub fn evaluate(settings: &Settings, s: &Signals) -> PauseReason {
    if settings.pause_locked && s.locked {
        PauseReason::Locked
    } else if settings.pause_fullscreen && s.fullscreen {
        PauseReason::Fullscreen
    } else if s.app_running {
        PauseReason::App
    } else if settings.pause_battery && s.on_battery {
        PauseReason::Battery
    } else if settings.pause_idle_minutes > 0 && s.idle_ms >= settings.pause_idle_minutes as u64 * 60_000 {
        PauseReason::Idle
    } else {
        PauseReason::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_respect_settings() {
        let on = Settings::default();
        let busy = Signals { fullscreen: true, idle_ms: 0, on_battery: true, app_running: false, locked: false };
        assert_eq!(evaluate(&on, &busy), PauseReason::Fullscreen);
        let off = Settings { pause_fullscreen: false, pause_battery: false, ..on.clone() };
        assert_eq!(evaluate(&off, &busy), PauseReason::None);
        let away = Signals { fullscreen: false, idle_ms: 11 * 60_000, on_battery: false, app_running: false, locked: false };
        assert_eq!(evaluate(&on, &away), PauseReason::Idle);
        assert_eq!(evaluate(&Settings { pause_idle_minutes: 0, ..on.clone() }, &away), PauseReason::None);
        let gaming = Signals { fullscreen: false, idle_ms: 0, on_battery: false, app_running: true, locked: false };
        assert_eq!(evaluate(&on, &gaming), PauseReason::App);
    }
}
