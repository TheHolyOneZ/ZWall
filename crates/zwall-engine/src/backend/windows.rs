

use super::{Backend, Hotkey, Input, Pointer, Rect, SurfaceHandles};
use raw_window_handle::{RawDisplayHandle, RawWindowHandle, Win32WindowHandle, WindowsDisplayHandle};
use std::{collections::HashMap, num::NonZeroIsize};
use windows::{
    core::{w, BOOL, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{EnumDisplayMonitors, GetMonitorInfoW, GetStockObject, MonitorFromWindow, ScreenToClient, BLACK_BRUSH, HBRUSH, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST},
        },
        System::{LibraryLoader::GetModuleHandleW, SystemInformation::GetTickCount},
        UI::{
            HiDpi::{GetDpiForMonitor, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI},
            Input::KeyboardAndMouse::{GetAsyncKeyState, GetLastInputInfo, RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, LASTINPUTINFO, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_WIN, VK_LBUTTON},
            Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN},
            WindowsAndMessaging::*,
        },
    },
};
use zwall_ipc::Monitor;

const CLASS: PCWSTR = w!("ZWallWallpaper");

pub struct WorkerW {

    parent: HWND,
    surfaces: HashMap<String, HWND>,
    hotkeys: Vec<(i32, Hotkey)>,
    left_down: bool,
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {

        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        WM_ERASEBKGND => LRESULT(1),
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];

    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}


fn find_workerw() -> Option<HWND> {

    unsafe {
        let progman = FindWindowW(w!("Progman"), PCWSTR::null()).ok()?;

        let mut result = 0usize;
        let _ = SendMessageTimeoutW(progman, 0x052C, WPARAM(0xD), LPARAM(0x1), SMTO_NORMAL, 1000, Some(&mut result));
        let _ = SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, Some(&mut result));


        if let Ok(child) = FindWindowExW(Some(progman), None, w!("WorkerW"), PCWSTR::null()) {
            return Some(child);
        }


        struct Found(Option<HWND>);
        unsafe extern "system" fn each(hwnd: HWND, lp: LPARAM) -> BOOL {
            unsafe {
                if FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), PCWSTR::null()).is_ok() {
                    if let Ok(worker) = FindWindowExW(None, Some(hwnd), w!("WorkerW"), PCWSTR::null()) {
                        (*(lp.0 as *mut Found)).0 = Some(worker);
                        return BOOL(0);
                    }
                }
            }
            BOOL(1)
        }
        let mut found = Found(None);
        let _ = EnumWindows(Some(each), LPARAM(&mut found as *mut Found as isize));
        if found.0.is_some() {
            return found.0;
        }

        log::warn!("windows: no WorkerW found, drawing into Progman");
        Some(progman)
    }
}

impl WorkerW {
    pub fn connect() -> anyhow::Result<Self> {

        unsafe {
            let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let instance = GetModuleHandleW(None)?;
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(wndproc),
                hInstance: instance.into(),
                hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
                hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
                lpszClassName: CLASS,
                ..Default::default()
            };
            RegisterClassExW(&wc);
        }
        let parent = find_workerw().ok_or_else(|| anyhow::anyhow!("Explorer's desktop window (Progman) wasn't found; is Explorer running?"))?;
        log::info!("windows: wallpapers go into a {} window", class_name(parent));
        Ok(Self { parent, surfaces: HashMap::new(), hotkeys: Vec::new(), left_down: false })
    }

    fn new_window(&self, key: &str, rect: Rect, overlay: bool) -> anyhow::Result<HWND> {
        let title: Vec<u16> = format!("zwall-surface:{key}").encode_utf16().chain(Some(0)).collect();

        unsafe {
            let instance = GetModuleHandleW(None)?;
            let hwnd = if overlay {
                CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, CLASS, PCWSTR(title.as_ptr()), WS_POPUP | WS_VISIBLE, rect.x, rect.y, rect.w as i32, rect.h as i32, None, None, Some(instance.into()), None)?
            } else {

                let mut p = POINT { x: rect.x, y: rect.y };
                let _ = ScreenToClient(self.parent, &mut p);
                CreateWindowExW(
                    WS_EX_NOACTIVATE,
                    CLASS,
                    PCWSTR(title.as_ptr()),
                    WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                    p.x,
                    p.y,
                    rect.w as i32,
                    rect.h as i32,
                    Some(self.parent),
                    None,
                    Some(instance.into()),
                    None,
                )?
            };
            let _ = ShowWindow(hwnd, SW_SHOWNA);
            Ok(hwnd)
        }
    }

    fn handles(hwnd: HWND) -> anyhow::Result<SurfaceHandles> {
        let raw = NonZeroIsize::new(hwnd.0 as isize).ok_or_else(|| anyhow::anyhow!("null window"))?;
        let mut handle = Win32WindowHandle::new(raw);

        handle.hinstance = unsafe { GetModuleHandleW(None) }.ok().and_then(|m| NonZeroIsize::new(m.0 as isize));
        Ok(SurfaceHandles { display: RawDisplayHandle::Windows(WindowsDisplayHandle::new()), window: RawWindowHandle::Win32(handle), native: hwnd.0 as u64 })
    }


    fn ours(&self, hwnd: HWND) -> bool {
        self.surfaces.values().any(|&h| h == hwnd) || class_name(hwnd) == "ZWallWallpaper"
    }


    fn repaint_desktop() {
        let mut path = [0u16; 520];

        unsafe {
            if SystemParametersInfoW(SPI_GETDESKWALLPAPER, path.len() as u32, Some(path.as_mut_ptr().cast()), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).is_ok() {
                let _ = SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, Some(path.as_mut_ptr().cast()), SPIF_SENDCHANGE);
            }
        }
    }
}

impl Drop for WorkerW {
    fn drop(&mut self) {
        let keys: Vec<String> = self.surfaces.keys().cloned().collect();
        for k in keys {
            self.destroy_surface(&k);
        }
        let _ = self.set_hotkeys(false);
    }
}

impl Backend for WorkerW {
    fn name(&self) -> &'static str {
        "windows"
    }

    fn monitors(&mut self) -> anyhow::Result<Vec<Monitor>> {
        unsafe extern "system" fn each(mon: HMONITOR, _: HDC, _: *mut RECT, lp: LPARAM) -> BOOL {
            unsafe {
                let out = &mut *(lp.0 as *mut Vec<Monitor>);
                let mut info = MONITORINFOEXW::default();
                info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
                if GetMonitorInfoW(mon, &mut info.monitorInfo as *mut MONITORINFO).as_bool() {
                    let r = info.monitorInfo.rcMonitor;
                    let len = info.szDevice.iter().position(|&c| c == 0).unwrap_or(info.szDevice.len());
                    let device = String::from_utf16_lossy(&info.szDevice[..len]);

                    let name = device.trim_start_matches(r"\\.\").to_string();
                    let (mut dx, mut dy) = (96u32, 96u32);
                    let _ = GetDpiForMonitor(mon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
                    out.push(Monitor {
                        name,
                        x: r.left,
                        y: r.top,
                        width: (r.right - r.left).max(0) as u32,
                        height: (r.bottom - r.top).max(0) as u32,
                        scale: dx as f64 / 96.0,
                        primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
                        wallpaper: None,
                        span: None,
                    });
                }
            }
            BOOL(1)
        }
        let mut out: Vec<Monitor> = Vec::new();

        unsafe {
            let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut out as *mut Vec<Monitor> as isize));
        }
        out.sort_by_key(|m| (m.x, m.y));
        Ok(out)
    }

    fn create_surface(&mut self, key: &str, rect: Rect) -> anyhow::Result<SurfaceHandles> {
        self.destroy_surface(key);
        let hwnd = self.new_window(key, rect, false)?;
        self.surfaces.insert(key.to_string(), hwnd);
        Self::handles(hwnd)
    }

    fn create_overlay(&mut self, key: &str, rect: Rect) -> anyhow::Result<SurfaceHandles> {
        self.destroy_surface(key);
        let hwnd = self.new_window(key, rect, true)?;
        self.surfaces.insert(key.to_string(), hwnd);
        Self::handles(hwnd)
    }

    fn destroy_surface(&mut self, key: &str) {
        if let Some(hwnd) = self.surfaces.remove(key) {

            unsafe {
                let _ = DestroyWindow(hwnd);
            }
            if !key.starts_with("saver:") && !self.surfaces.keys().any(|k| !k.starts_with("saver:")) {
                Self::repaint_desktop();
            }
        }
    }

    fn surfaces_lost(&mut self) -> bool {

        if unsafe { IsWindow(Some(self.parent)) }.as_bool() {
            return false;
        }

        self.surfaces.clear();
        if let Some(p) = find_workerw() {
            self.parent = p;
        }
        true
    }

    fn pointer(&self) -> Option<Pointer> {
        let mut p = POINT::default();

        unsafe { GetCursorPos(&mut p) }.ok()?;
        Some(Pointer { x: p.x, y: p.y })
    }

    fn pump(&mut self) -> Input {
        let mut input = Input::default();

        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_HOTKEY {
                    if let Some((_, h)) = self.hotkeys.iter().find(|(id, _)| *id as usize == msg.wParam.0) {
                        input.hotkeys.push(*h);
                    }
                    continue;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            let down = GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0;
            if down && !self.left_down {
                let mut p = POINT::default();
                if GetCursorPos(&mut p).is_ok() {
                    let under = WindowFromPoint(p);
                    let class = class_name(under);
                    if matches!(class.as_str(), "SysListView32" | "SHELLDLL_DefView" | "WorkerW" | "Progman" | "ZWallWallpaper") {
                        input.clicks.push((p.x, p.y));
                    }
                }
            }
            self.left_down = down;
        }
        input
    }

    fn set_hotkeys(&mut self, on: bool) -> Vec<String> {

        unsafe {
            for (id, _) in self.hotkeys.drain(..) {
                let _ = UnregisterHotKey(None, id);
            }
        }
        let mut active = Vec::new();
        if !on {
            return active;
        }
        let combos: [(HOT_KEY_MODIFIERS, &str); 2] = [(MOD_WIN | MOD_ALT, "Win+Alt"), (MOD_WIN | MOD_CONTROL | MOD_ALT, "Win+Ctrl+Alt")];
        for (id, key, h, what) in [(1, 'P', Hotkey::Pause, "pause"), (2, 'M', Hotkey::Mute, "mute"), (3, 'N', Hotkey::Next, "next wallpaper")] {
            let got = combos.iter().find(|(mods, _)| {

                unsafe { RegisterHotKey(None, id, *mods | MOD_NOREPEAT, key as u32) }.is_ok()
            });
            match got {
                Some((_, name)) => {
                    self.hotkeys.push((id, h));
                    active.push(format!("{name}+{key} · {what}"));
                }
                None => log::warn!("windows: no free shortcut for {what}"),
            }
        }
        active
    }

    fn idle_ms(&self) -> u64 {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };

        if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
            return 0;
        }

        unsafe { GetTickCount() }.wrapping_sub(info.dwTime) as u64
    }

    fn fullscreen_active(&self) -> bool {


        if let Ok(state) = unsafe { SHQueryUserNotificationState() } {
            if state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE {
                return true;
            }
        }


        unsafe {
            let fg = GetForegroundWindow();
            if fg.0.is_null() || matches!(class_name(fg).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
                return false;
            }
            let mut r = RECT::default();
            if GetWindowRect(fg, &mut r).is_err() {
                return false;
            }
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST), &mut info).as_bool() {
                return false;
            }
            let m = info.rcMonitor;
            r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
        }
    }

    fn covered(&self, rect: Rect) -> Option<f32> {
        struct Ctx<'a> {
            me: &'a WorkerW,
            rects: Vec<RECT>,
        }
        unsafe extern "system" fn each(hwnd: HWND, lp: LPARAM) -> BOOL {
            unsafe {
                let ctx = &mut *(lp.0 as *mut Ctx);
                if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || ctx.me.ours(hwnd) {
                    return BOOL(1);
                }
                let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
                if ex & WS_EX_TOOLWINDOW.0 != 0 || ex & WS_EX_NOACTIVATE.0 != 0 {
                    return BOOL(1);
                }
                if matches!(class_name(hwnd).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
                    return BOOL(1);
                }

                let mut cloaked = 0u32;
                if DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4).is_ok() && cloaked != 0 {
                    return BOOL(1);
                }

                if ex & WS_EX_LAYERED.0 != 0 {
                    let mut alpha = 255u8;
                    let mut flags = LAYERED_WINDOW_ATTRIBUTES_FLAGS(0);
                    if GetLayeredWindowAttributes(hwnd, None, Some(&mut alpha), Some(&mut flags)).is_ok() && flags.0 & LWA_ALPHA.0 != 0 && alpha < 245 {
                        return BOOL(1);
                    }
                }
                let mut r = RECT::default();
                if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).is_err() && GetWindowRect(hwnd, &mut r).is_err() {
                    return BOOL(1);
                }
                ctx.rects.push(r);
            }
            BOOL(1)
        }
        let mut ctx = Ctx { me: self, rects: Vec::new() };

        unsafe {
            let _ = EnumWindows(Some(each), LPARAM(&mut ctx as *mut Ctx as isize));
        }
        let (cols, rows) = (32, 18);
        let mut hit = 0;
        for j in 0..rows {
            for i in 0..cols {
                let x = rect.x + ((i as f32 + 0.5) / cols as f32 * rect.w as f32) as i32;
                let y = rect.y + ((j as f32 + 0.5) / rows as f32 * rect.h as f32) as i32;
                if ctx.rects.iter().any(|r| x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
                    hit += 1;
                }
            }
        }
        Some(hit as f32 / (cols * rows) as f32)
    }
}
