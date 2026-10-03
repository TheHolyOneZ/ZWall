

use libmpv2::Mpv;

pub struct Video {


    gl: Option<gl::GlTarget>,
    mpv: Mpv,
    paused: bool,
    volume: f64,
    speed: f64,
}

impl Video {
    pub fn new(wid: u64, path: &str) -> anyhow::Result<Self> {
        let mpv = Mpv::with_initializer(|i| {
            i.set_option("wid", wid as i64)?;
            i.set_option("vo", "gpu")?;
            i.set_option("hwdec", "auto-safe")?;
            i.set_option("loop-file", "inf")?;

            i.set_option("panscan", 1.0)?;
            i.set_option("osc", false)?;
            i.set_option("osd-level", 0i64)?;
            i.set_option("input-default-bindings", false)?;
            i.set_option("input-vo-keyboard", false)?;
            i.set_option("input-cursor", false)?;
            i.set_option("cursor-autohide", "no")?;
            i.set_option("stop-screensaver", false)?;
            i.set_option("audio-client-name", "ZWall")?;
            i.set_option("volume", 0.0)?;
            Ok(())
        })
        .map_err(|e| anyhow::anyhow!("mpv: {e}"))?;
        mpv.command("loadfile", &[path]).map_err(|e| anyhow::anyhow!("mpv could not open {path}: {e}"))?;
        Ok(Self { gl: None, mpv, paused: false, volume: 0.0, speed: 1.0 })
    }


    pub fn new_wayland(display: *mut std::ffi::c_void, surface: *mut std::ffi::c_void, w: u32, h: u32, path: &str) -> anyhow::Result<Self> {
        let mpv = Mpv::with_initializer(|i| {
            i.set_option("vo", "libmpv")?;
            i.set_option("hwdec", "auto-safe")?;
            i.set_option("loop-file", "inf")?;
            i.set_option("panscan", 1.0)?;
            i.set_option("osd-level", 0i64)?;
            i.set_option("input-default-bindings", false)?;
            i.set_option("stop-screensaver", false)?;
            i.set_option("audio-client-name", "ZWall")?;
            i.set_option("volume", 0.0)?;
            Ok(())
        })
        .map_err(|e| anyhow::anyhow!("mpv: {e}"))?;
        let gl = gl::GlTarget::new(&mpv, display, surface, w, h)?;
        mpv.command("loadfile", &[path]).map_err(|e| anyhow::anyhow!("mpv could not open {path}: {e}"))?;
        Ok(Self { gl: Some(gl), mpv, paused: false, volume: 0.0, speed: 1.0 })
    }


    pub fn draw(&mut self) {
        if let Some(gl) = &mut self.gl {
            gl.draw();
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        if self.paused != paused {
            self.paused = paused;
            let _ = self.mpv.set_property("pause", paused);
        }
    }


    pub fn set_volume(&mut self, volume: f64) {
        if (self.volume - volume).abs() > 0.1 {
            self.volume = volume;
            let _ = self.mpv.set_property("volume", volume);
        }
    }

    pub fn set_speed(&mut self, speed: f64) {
        let speed = speed.clamp(0.05, 3.0);
        if (self.speed - speed).abs() > 0.001 {
            self.speed = speed;
            let _ = self.mpv.set_property("speed", speed);
        }
    }
}

mod gl {

    use khronos_egl as egl;
    use libmpv2::Mpv;
    use libmpv2_sys as sys;
    use std::{
        ffi::{c_char, c_void, CStr},
        sync::atomic::{AtomicBool, Ordering},
    };

    #[link(name = "wayland-egl")]
    unsafe extern "C" {
        fn wl_egl_window_create(surface: *mut c_void, width: i32, height: i32) -> *mut c_void;
        fn wl_egl_window_destroy(window: *mut c_void);
    }

    type Egl = egl::DynamicInstance<egl::EGL1_4>;

    pub struct GlTarget {
        egl: Box<Egl>,
        display: egl::Display,
        context: egl::Context,
        surface: egl::Surface,
        window: *mut c_void,
        rc: *mut sys::mpv_render_context,
        dirty: Box<AtomicBool>,
        w: i32,
        h: i32,
    }

    unsafe extern "C" fn proc_address(ctx: *mut c_void, name: *const c_char) -> *mut c_void {
        let egl = unsafe { &*(ctx as *const Egl) };
        let name = unsafe { CStr::from_ptr(name) }.to_str().unwrap_or("");
        egl.get_proc_address(name).map_or(std::ptr::null_mut(), |f| f as *mut c_void)
    }

    unsafe extern "C" fn on_update(ctx: *mut c_void) {
        unsafe { &*(ctx as *const AtomicBool) }.store(true, Ordering::Release);
    }

    impl GlTarget {
        pub fn new(mpv: &Mpv, display: *mut c_void, wl_surface: *mut c_void, w: u32, h: u32) -> anyhow::Result<Self> {
            let egl = Box::new(unsafe { Egl::load_required() }.map_err(|e| anyhow::anyhow!("libEGL: {e}"))?);
            let dpy = unsafe { egl.get_display(display as egl::NativeDisplayType) }.ok_or_else(|| anyhow::anyhow!("no EGL display"))?;
            egl.initialize(dpy)?;
            egl.bind_api(egl::OPENGL_API)?;
            let attrs = [egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::SURFACE_TYPE, egl::WINDOW_BIT, egl::RENDERABLE_TYPE, egl::OPENGL_BIT, egl::NONE];
            let config = egl.choose_first_config(dpy, &attrs)?.ok_or_else(|| anyhow::anyhow!("no EGL config"))?;
            let context = egl.create_context(dpy, config, None, &[egl::NONE])?;
            let window = unsafe { wl_egl_window_create(wl_surface, w as i32, h as i32) };
            anyhow::ensure!(!window.is_null(), "wl_egl_window_create failed");
            let surface = unsafe { egl.create_window_surface(dpy, config, window as egl::NativeWindowType, None) }?;
            egl.make_current(dpy, Some(surface), Some(surface), Some(context))?;

            let _ = egl.swap_interval(dpy, 0);
            let dirty = Box::new(AtomicBool::new(true));
            let mut init = sys::mpv_opengl_init_params { get_proc_address: Some(proc_address), get_proc_address_ctx: &*egl as *const Egl as *mut c_void };
            let api = c"opengl";
            let mut params = [
                sys::mpv_render_param { type_: sys::mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE, data: api.as_ptr() as *mut c_void },
                sys::mpv_render_param { type_: sys::mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, data: &mut init as *mut _ as *mut c_void },
                sys::mpv_render_param { type_: sys::mpv_render_param_type_MPV_RENDER_PARAM_WL_DISPLAY, data: display },
                sys::mpv_render_param { type_: 0, data: std::ptr::null_mut() },
            ];
            let mut rc: *mut sys::mpv_render_context = std::ptr::null_mut();
            let err = unsafe { sys::mpv_render_context_create(&mut rc, mpv.ctx.as_ptr(), params.as_mut_ptr()) };
            anyhow::ensure!(err >= 0 && !rc.is_null(), "mpv render context failed ({err})");
            unsafe { sys::mpv_render_context_set_update_callback(rc, Some(on_update), &*dirty as *const AtomicBool as *mut c_void) };
            Ok(Self { egl, display: dpy, context, surface, window, rc, dirty, w: w as i32, h: h as i32 })
        }

        pub fn draw(&mut self) {
            if !self.dirty.swap(false, Ordering::AcqRel) {
                return;
            }
            let flags = unsafe { sys::mpv_render_context_update(self.rc) };
            if flags & sys::mpv_render_update_flag_MPV_RENDER_UPDATE_FRAME as u64 == 0 {
                return;
            }
            if self.egl.make_current(self.display, Some(self.surface), Some(self.surface), Some(self.context)).is_err() {
                return;
            }
            let mut fbo = sys::mpv_opengl_fbo { fbo: 0, w: self.w, h: self.h, internal_format: 0 };
            let mut flip: i32 = 1;
            let mut params = [
                sys::mpv_render_param { type_: sys::mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO, data: &mut fbo as *mut _ as *mut c_void },
                sys::mpv_render_param { type_: sys::mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y, data: &mut flip as *mut _ as *mut c_void },
                sys::mpv_render_param { type_: 0, data: std::ptr::null_mut() },
            ];
            unsafe { sys::mpv_render_context_render(self.rc, params.as_mut_ptr()) };
            let _ = self.egl.swap_buffers(self.display, self.surface);
        }
    }

    impl Drop for GlTarget {
        fn drop(&mut self) {
            let _ = self.egl.make_current(self.display, Some(self.surface), Some(self.surface), Some(self.context));
            unsafe { sys::mpv_render_context_free(self.rc) };
            let _ = self.egl.make_current(self.display, None, None, None);
            let _ = self.egl.destroy_surface(self.display, self.surface);
            let _ = self.egl.destroy_context(self.display, self.context);
            unsafe { wl_egl_window_destroy(self.window) };
        }
    }
}
