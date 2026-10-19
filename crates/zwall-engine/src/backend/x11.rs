use super::{Backend, Hotkey, Input, Pointer, Rect, SurfaceHandles};
use raw_window_handle::{RawDisplayHandle, RawWindowHandle, XcbDisplayHandle, XcbWindowHandle};
use std::{collections::HashMap, num::NonZeroU32, ptr::NonNull};
use x11rb::{
    connection::Connection,
    protocol::{
        randr::ConnectionExt as _,
        xinput::{self, ConnectionExt as _},
        screensaver::ConnectionExt as _,
        shape::{self, ConnectionExt as _},
        xproto::{AtomEnum, ChangeWindowAttributesAux, ClipOrdering, ConfigureWindowAux, ConnectionExt as _, CreateWindowAux, EventMask, GrabMode, ModMask, PropMode, StackMode, Window, WindowClass},
        Event,
    },
    wrapper::ConnectionExt as _,
    xcb_ffi::XCBConnection,
};
use zwall_ipc::Monitor;

x11rb::atom_manager! {
    Atoms: AtomsCookie {
        _NET_WM_WINDOW_TYPE,
        _NET_WM_WINDOW_TYPE_DESKTOP,
        _NET_WM_STATE,
        _NET_WM_STATE_BELOW,
        _NET_WM_STATE_STICKY,
        _NET_WM_STATE_SKIP_TASKBAR,
        _NET_WM_STATE_SKIP_PAGER,
        _NET_WM_STATE_FULLSCREEN,
        _NET_WM_DESKTOP,
        _NET_WM_NAME,
        _NET_ACTIVE_WINDOW,
        _NET_CLIENT_LIST_STACKING,
        _NET_CLIENT_LIST,
        _NET_CURRENT_DESKTOP,
        _NET_WM_STATE_HIDDEN,
        _NET_WM_WINDOW_TYPE_NORMAL,
        _NET_WM_WINDOW_TYPE_DIALOG,
        UTF8_STRING,
    }
}

pub struct X11 {
    conn: XCBConnection,
    screen: usize,
    root: Window,
    atoms: Atoms,
    windows: HashMap<String, Window>,

    hotkeys: Vec<(u8, u16, Hotkey)>,
}

impl X11 {
    pub fn connect() -> anyhow::Result<Self> {
        let (conn, screen) = XCBConnection::connect(None)?;
        let root = conn.setup().roots[screen].root;
        let atoms = Atoms::new(&conn)?.reply()?;

        conn.change_window_attributes(root, &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE))?;

        match conn.xinput_xi_query_version(2, 0).map(|c| c.reply()) {
            Ok(Ok(_)) => {
                const ALL_MASTER_DEVICES: u16 = 1;
                conn.xinput_xi_select_events(root, &[xinput::EventMask { deviceid: ALL_MASTER_DEVICES, mask: vec![xinput::XIEventMask::RAW_BUTTON_PRESS] }])?;
            }
            _ => log::warn!("x11: XInput2 missing, desktop clicks won't ripple"),
        }
        conn.flush()?;
        Ok(Self { conn, screen, root, atoms, windows: HashMap::new(), hotkeys: Vec::new() })
    }

    fn window_rects(&self) -> Option<Vec<Rect>> {
        let c = &self.conn;
        let a = &self.atoms;
        let prop32 = |w: Window, atom: u32, ty: AtomEnum, len: u32| -> Option<Vec<u32>> {
            c.get_property(false, w, atom, ty, 0, len).ok()?.reply().ok()?.value32().map(|v| v.collect())
        };
        let clients = prop32(self.root, a._NET_CLIENT_LIST, AtomEnum::WINDOW, 4096)?;
        let current = prop32(self.root, a._NET_CURRENT_DESKTOP, AtomEnum::CARDINAL, 1).and_then(|v| v.first().copied()).unwrap_or(0);
        let mut out = Vec::new();
        for w in clients {
            if self.windows.values().any(|o| *o == w) {
                continue;
            }
            let types = prop32(w, a._NET_WM_WINDOW_TYPE, AtomEnum::ATOM, 8).unwrap_or_default();
            if !types.is_empty() && !types.iter().any(|t| *t == a._NET_WM_WINDOW_TYPE_NORMAL || *t == a._NET_WM_WINDOW_TYPE_DIALOG) {
                continue;
            }
            if prop32(w, a._NET_WM_STATE, AtomEnum::ATOM, 32).unwrap_or_default().contains(&a._NET_WM_STATE_HIDDEN) {
                continue;
            }
            let desk = prop32(w, a._NET_WM_DESKTOP, AtomEnum::CARDINAL, 1).and_then(|v| v.first().copied()).unwrap_or(current);
            if desk != current && desk != u32::MAX {
                continue;
            }
            let Some(g) = c.get_geometry(w).ok().and_then(|x| x.reply().ok()) else { continue };
            let Some(t) = c.translate_coordinates(w, self.root, 0, 0).ok().and_then(|x| x.reply().ok()) else { continue };
            let r = Rect { x: t.dst_x.into(), y: t.dst_y.into(), w: g.width.into(), h: g.height.into() };

            if crate::kwin_bridge::see_through(r) {
                continue;
            }
            out.push(r);
        }
        Some(out)
    }

    fn typed_desktop(&self, w: Window) -> bool {
        self.conn
            .get_property(false, w, self.atoms._NET_WM_WINDOW_TYPE, AtomEnum::ATOM, 0, 8)
            .ok()
            .and_then(|c| c.reply().ok())
            .and_then(|r| r.value32().map(|mut v| v.any(|a| a == self.atoms._NET_WM_WINDOW_TYPE_DESKTOP)))
            .unwrap_or(false)
    }

    fn is_desktop(&self, win: Window) -> bool {
        win == 0 || self.contains_desktop(win, 3)
    }

    fn contains_desktop(&self, win: Window, depth: u32) -> bool {
        if self.windows.values().any(|w| *w == win) || self.typed_desktop(win) {
            return true;
        }
        depth > 0
            && self
                .conn
                .query_tree(win)
                .ok()
                .and_then(|c| c.reply().ok())
                .is_some_and(|t| t.children.into_iter().any(|c| self.contains_desktop(c, depth - 1)))
    }

    fn atom_name(&self, atom: u32) -> anyhow::Result<String> {
        Ok(String::from_utf8_lossy(&self.conn.get_atom_name(atom)?.reply()?.name).into_owned())
    }
}

impl Backend for X11 {
    fn name(&self) -> &'static str {
        "x11"
    }

    fn monitors(&mut self) -> anyhow::Result<Vec<Monitor>> {
        let reply = self.conn.randr_get_monitors(self.root, true)?.reply()?;
        reply
            .monitors
            .iter()
            .map(|m| {
                Ok(Monitor {
                    name: self.atom_name(m.name)?,
                    x: m.x.into(),
                    y: m.y.into(),
                    width: m.width.into(),
                    height: m.height.into(),

                    scale: 1.0,
                    primary: m.primary,
                    wallpaper: None,
                    span: None,
                })
            })
            .collect()
    }

    fn create_overlay(&mut self, key: &str, r: Rect) -> anyhow::Result<SurfaceHandles> {
        self.destroy_surface(key);
        let c = &self.conn;
        let screen = &c.setup().roots[self.screen];
        let win = c.generate_id()?;

        c.create_window(
            x11rb::COPY_DEPTH_FROM_PARENT,
            win,
            self.root,
            r.x as i16,
            r.y as i16,
            r.w as u16,
            r.h as u16,
            0,
            WindowClass::INPUT_OUTPUT,
            screen.root_visual,
            &CreateWindowAux::new().background_pixel(screen.black_pixel).override_redirect(1),
        )?;
        let title = format!("zwall-screensaver:{key}");
        c.change_property8(PropMode::REPLACE, win, AtomEnum::WM_NAME, AtomEnum::STRING, title.as_bytes())?;
        c.map_window(win)?;
        c.configure_window(win, &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE))?;
        c.flush()?;
        self.windows.insert(key.to_string(), win);
        let display = XcbDisplayHandle::new(NonNull::new(c.get_raw_xcb_connection()), self.screen as i32);
        let mut window = XcbWindowHandle::new(NonZeroU32::new(win).expect("X ids are non-zero"));
        window.visual_id = NonZeroU32::new(screen.root_visual);
        Ok(SurfaceHandles { display: RawDisplayHandle::Xcb(display), window: RawWindowHandle::Xcb(window), native: win as u64 })
    }

    fn create_surface(&mut self, key: &str, r: Rect) -> anyhow::Result<SurfaceHandles> {
        self.destroy_surface(key);
        let c = &self.conn;
        let a = &self.atoms;
        let screen = &c.setup().roots[self.screen];
        let win = c.generate_id()?;
        c.create_window(
            x11rb::COPY_DEPTH_FROM_PARENT,
            win,
            self.root,
            r.x as i16,
            r.y as i16,
            r.w as u16,
            r.h as u16,
            0,
            WindowClass::INPUT_OUTPUT,
            screen.root_visual,
            &CreateWindowAux::new().background_pixel(screen.black_pixel),
        )?;
        c.change_property32(PropMode::REPLACE, win, a._NET_WM_WINDOW_TYPE, AtomEnum::ATOM, &[a._NET_WM_WINDOW_TYPE_DESKTOP])?;
        c.change_property32(
            PropMode::REPLACE,
            win,
            a._NET_WM_STATE,
            AtomEnum::ATOM,
            &[a._NET_WM_STATE_BELOW, a._NET_WM_STATE_STICKY, a._NET_WM_STATE_SKIP_TASKBAR, a._NET_WM_STATE_SKIP_PAGER],
        )?;
        c.change_property32(PropMode::REPLACE, win, a._NET_WM_DESKTOP, AtomEnum::CARDINAL, &[u32::MAX])?;
        let title = format!("zwall-surface:{key}");
        c.change_property8(PropMode::REPLACE, win, a._NET_WM_NAME, a.UTF8_STRING, title.as_bytes())?;
        c.change_property8(PropMode::REPLACE, win, AtomEnum::WM_NAME, AtomEnum::STRING, title.as_bytes())?;
        c.change_property8(PropMode::REPLACE, win, AtomEnum::WM_CLASS, AtomEnum::STRING, b"zwall-surface\0ZWall\0")?;

        c.shape_rectangles(shape::SO::SET, shape::SK::INPUT, ClipOrdering::UNSORTED, win, 0, 0, &[])?;
        c.map_window(win)?;
        c.configure_window(win, &ConfigureWindowAux::new().stack_mode(StackMode::BELOW))?;
        c.flush()?;
        self.windows.insert(key.to_string(), win);

        let display = XcbDisplayHandle::new(NonNull::new(c.get_raw_xcb_connection()), self.screen as i32);
        let mut window = XcbWindowHandle::new(NonZeroU32::new(win).expect("X ids are non-zero"));
        window.visual_id = NonZeroU32::new(screen.root_visual);
        Ok(SurfaceHandles { display: RawDisplayHandle::Xcb(display), window: RawWindowHandle::Xcb(window), native: win as u64 })
    }

    fn destroy_surface(&mut self, monitor: &str) {
        if let Some(win) = self.windows.remove(monitor) {
            let _ = self.conn.destroy_window(win);
            let _ = self.conn.flush();
        }
    }

    fn pointer(&self) -> Option<Pointer> {
        let r = self.conn.query_pointer(self.root).ok()?.reply().ok()?;
        Some(Pointer { x: r.root_x.into(), y: r.root_y.into() })
    }

    fn pump(&mut self) -> Input {
        let mut restacked = false;
        let mut input = Input::default();
        while let Ok(Some(ev)) = self.conn.poll_for_event() {
            match ev {
                Event::PropertyNotify(p) => restacked |= p.atom == self.atoms._NET_CLIENT_LIST_STACKING,

                Event::XinputRawButtonPress(b) if b.detail == 1 => {
                    if let Some(r) = self.conn.query_pointer(self.root).ok().and_then(|c| c.reply().ok()) {
                        if self.is_desktop(r.child) {
                            input.clicks.push((r.root_x.into(), r.root_y.into()));
                        }
                    }
                }
                Event::KeyPress(k) => {
                    if let Some((_, _, h)) = self.hotkeys.iter().find(|(code, mods, _)| *code == k.detail && (u16::from(k.state) & !(u16::from(ModMask::M2) | u16::from(ModMask::LOCK))) == *mods) {
                        input.hotkeys.push(*h);
                    }
                }
                _ => {}
            }
        }

        if restacked && !self.windows.is_empty() {
            self.restack();
        }
        input
    }

    fn set_hotkeys(&mut self, on: bool) -> Vec<String> {
        let locks = [0, u16::from(ModMask::M2), u16::from(ModMask::LOCK), u16::from(ModMask::M2) | u16::from(ModMask::LOCK)];
        for (code, mods, _) in self.hotkeys.drain(..) {
            for l in locks {
                let _ = self.conn.ungrab_key(code, self.root, ModMask::from(mods | l));
            }
        }
        let mut active = Vec::new();
        if on {
            let setup = self.conn.setup();
            let (min, max) = (setup.min_keycode, setup.max_keycode);
            let Some(map) = self.conn.get_keyboard_mapping(min, max - min + 1).ok().and_then(|c| c.reply().ok()) else { return active };
            let per = map.keysyms_per_keycode as usize;
            let code_for = |sym: u32| map.keysyms.chunks(per).position(|c| c.first() == Some(&sym)).map(|i| min + i as u8);
            let super_alt = u16::from(ModMask::M4) | u16::from(ModMask::M1);

            let combos = [(super_alt, "Super+Alt"), (super_alt | u16::from(ModMask::CONTROL), "Super+Ctrl+Alt")];
            for (sym, h, what) in [(0x70, Hotkey::Pause, "pause"), (0x6d, Hotkey::Mute, "mute"), (0x6e, Hotkey::Next, "next wallpaper")] {
                let Some(code) = code_for(sym) else { continue };
                let key = char::from_u32(sym).unwrap_or('?').to_ascii_uppercase();
                let got = combos.iter().find(|(mods, _)| {
                    let ok = locks.iter().all(|l| {
                        matches!(self.conn.grab_key(true, self.root, ModMask::from(mods | l), code, GrabMode::ASYNC, GrabMode::ASYNC).map(|c| c.check()), Ok(Ok(())))
                    });
                    if !ok {
                        for l in locks {
                            let _ = self.conn.ungrab_key(code, self.root, ModMask::from(mods | l));
                        }
                    }
                    ok
                });
                match got {
                    Some((mods, name)) => {
                        self.hotkeys.push((code, *mods, h));
                        active.push(format!("{name}+{key} · {what}"));
                    }
                    None => log::warn!("x11: no free shortcut for {what}"),
                }
            }
            log::info!("x11: shortcuts {active:?}");
        }
        let _ = self.conn.flush();
        active
    }

    fn idle_ms(&self) -> u64 {
        self.conn.screensaver_query_info(self.root).ok().and_then(|c| c.reply().ok()).map_or(0, |i| i.ms_since_user_input as u64)
    }

    fn covered(&self, rect: Rect) -> Option<f32> {
        let rects = self.window_rects()?;

        let (cols, rows) = (32, 18);
        let mut hit = 0;
        for j in 0..rows {
            for i in 0..cols {
                let x = rect.x + ((i as f32 + 0.5) / cols as f32 * rect.w as f32) as i32;
                let y = rect.y + ((j as f32 + 0.5) / rows as f32 * rect.h as f32) as i32;
                if rects.iter().any(|r| x >= r.x && y >= r.y && x < r.x + r.w as i32 && y < r.y + r.h as i32) {
                    hit += 1;
                }
            }
        }
        Some(hit as f32 / (cols * rows) as f32)
    }

    fn fullscreen_active(&self) -> bool {
        let active = || -> Option<bool> {
            let w = self.conn.get_property(false, self.root, self.atoms._NET_ACTIVE_WINDOW, AtomEnum::WINDOW, 0, 1).ok()?.reply().ok()?.value32()?.next()?;
            if w == 0 {
                return Some(false);
            }
            let state = self.conn.get_property(false, w, self.atoms._NET_WM_STATE, AtomEnum::ATOM, 0, 32).ok()?.reply().ok()?;
            let mut atoms = state.value32()?;
            Some(atoms.any(|a| a == self.atoms._NET_WM_STATE_FULLSCREEN))
        };
        active().unwrap_or(false)
    }
}

impl X11 {
    fn restack(&self) {
        let Some(stack) = self
            .conn
            .get_property(false, self.root, self.atoms._NET_CLIENT_LIST_STACKING, AtomEnum::WINDOW, 0, 4096)
            .ok()
            .and_then(|c| c.reply().ok())
            .and_then(|r| r.value32().map(|v| v.collect::<Vec<u32>>()))
        else {
            return;
        };
        let ours: Vec<Window> = self.windows.values().copied().collect();
        for &win in &ours {
            let Some(i) = stack.iter().position(|&w| w == win) else { continue };
            let over_desktop = stack[..i].iter().any(|&w| !ours.contains(&w) && self.typed_desktop(w));
            if over_desktop {
                log::debug!("x11: wallpaper above the desktop window; lowering it");
                let _ = self.conn.configure_window(win, &ConfigureWindowAux::new().stack_mode(StackMode::BELOW));
                let _ = self.conn.flush();
            }
        }
    }
}

impl Drop for X11 {
    fn drop(&mut self) {
        for (_, w) in self.windows.drain() {
            let _ = self.conn.destroy_window(w);
        }
        let _ = self.conn.flush();
    }
}
