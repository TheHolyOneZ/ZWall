

use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use windows::{
    core::{w, Interface},
    Win32::{
        Foundation::{CloseHandle, HANDLE, S_OK},
        Media::Audio::{eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator},
        System::{
            Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
            Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
            Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
            Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
            StationsAndDesktops::{CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_READOBJECTS, UOI_NAME},
        },
        UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN},
    },
};

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}


pub fn data_dir() -> PathBuf {
    env_dir("LOCALAPPDATA").or_else(|| env_dir("USERPROFILE").map(|p| p.join("AppData").join("Local"))).unwrap_or_else(std::env::temp_dir).join("ZWall")
}


pub fn cache_dir() -> Option<PathBuf> {
    Some(data_dir().join("cache"))
}


pub fn config_dir() -> Option<PathBuf> {
    Some(env_dir("APPDATA").or_else(|| env_dir("USERPROFILE").map(|p| p.join("AppData").join("Roaming")))?.join("ZWall"))
}


pub fn accent() -> Option<String> {
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;

    let err = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, w!(r"Software\Microsoft\Windows\DWM"), w!("AccentColor"), RRF_RT_REG_DWORD, None, Some(&mut value as *mut u32 as *mut _), Some(&mut size))
    };
    if err.is_err() {
        return None;
    }
    let (r, g, b) = (value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
    Some(format!("#{r:02x}{g:02x}{b:02x}"))
}


pub fn on_battery() -> bool {
    let mut s = SYSTEM_POWER_STATUS::default();

    if unsafe { GetSystemPowerStatus(&mut s) }.is_err() {
        return false;
    }

    s.ACLineStatus == 0 && s.BatteryFlag != 128
}


pub fn process_names() -> Vec<String> {
    processes().into_iter().map(|(_, n)| n).collect()
}


fn processes() -> Vec<(u32, String)> {
    let mut out = Vec::new();

    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            let name = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
            out.push((e.th32ProcessID, name.strip_suffix(".exe").unwrap_or(&name).to_string()));
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}


pub fn idle_inhibited() -> bool {

    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}


pub fn screen_locked() -> bool {

    unsafe {
        let Ok(desk) = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) else { return true };
        let mut name = [0u16; 64];
        let mut needed = 0u32;
        let ok = GetUserObjectInformationW(HANDLE(desk.0), UOI_NAME, Some(name.as_mut_ptr().cast()), (name.len() * 2) as u32, Some(&mut needed)).is_ok();
        let _ = CloseDesktop(desk);
        if !ok {
            return false;
        }
        let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
        !String::from_utf16_lossy(&name[..len]).eq_ignore_ascii_case("default")
    }
}


pub fn others_playing() -> bool {
    static CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);
    let mut c = CACHE.lock().unwrap();
    if let Some((t, v)) = *c {
        if t.elapsed() < Duration::from_secs(2) {
            return v;
        }
    }
    let v = audio_sessions_playing().unwrap_or(false);
    *c = Some((Instant::now(), v));
    v
}

fn audio_sessions_playing() -> windows::core::Result<bool> {
    let me = std::process::id();
    let names = processes();
    let ours = |pid: u32| pid == me || pid == 0 || names.iter().any(|(p, n)| *p == pid && (n.starts_with("zwall") || n == "mpv"));


    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = devices.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;
        for i in 0..sessions.GetCount()? {
            let Ok(control) = sessions.GetSession(i) else { continue };
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };

            if control.GetState().is_ok_and(|s| s == AudioSessionStateActive) && !ours(control2.GetProcessId().unwrap_or(0)) && control2.IsSystemSoundsSession() != S_OK {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
