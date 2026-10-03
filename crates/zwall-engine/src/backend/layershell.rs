

use super::{Backend, Input, Pointer, Rect, SurfaceHandles};
use raw_window_handle::{RawDisplayHandle, RawWindowHandle, WaylandDisplayHandle, WaylandWindowHandle};
use smithay_client_toolkit::{
    compositor::{CompositorHandler, CompositorState, Region},
    delegate_registry,
    output::{OutputHandler, OutputState},
    reexports::client::{
        globals::registry_queue_init,
        protocol::{wl_output, wl_pointer, wl_seat, wl_surface},
        Connection, EventQueue, Proxy, QueueHandle,
    },
    registry::{ProvidesRegistryState, RegistryState},
    registry_handlers,
    seat::{
        pointer::{PointerEvent, PointerEventKind, PointerHandler, BTN_LEFT},
        Capability, SeatHandler, SeatState,
    },
    shell::{
        wlr_layer::{Anchor, KeyboardInteractivity, Layer, LayerShell as WlrLayerShell, LayerShellHandler, LayerSurface, LayerSurfaceConfigure},
        WaylandSurface,
    },
};
use std::{collections::HashMap, ptr::NonNull};
use zwall_ipc::Monitor;

struct Surf {
    layer: LayerSurface,
    rect: Rect,

    scale: i32,
    configured: bool,
}

struct State {
    registry: RegistryState,
    outputs: OutputState,
    seat: SeatState,
    compositor: CompositorState,
    layer_shell: WlrLayerShell,
    surfaces: HashMap<String, Surf>,
    pointer: Option<wl_pointer::WlPointer>,

    hover: Option<(i32, i32)>,
    clicks: Vec<(i32, i32)>,
}

pub struct LayerShell {
    conn: Connection,
    queue: EventQueue<State>,
    qh: QueueHandle<State>,
    state: State,
    hypr: Option<super::hyprland::Hyprland>,
}

impl LayerShell {
    pub fn connect() -> anyhow::Result<Self> {
        let conn = Connection::connect_to_env()?;
        let (globals, mut queue) = registry_queue_init::<State>(&conn)?;
        let qh = queue.handle();
        let layer_shell = WlrLayerShell::bind(&globals, &qh).map_err(|_| anyhow::anyhow!("this compositor has no wlr-layer-shell, so wallpapers can't go under windows"))?;
        let mut state = State {
            registry: RegistryState::new(&globals),
            outputs: OutputState::new(&globals, &qh),
            seat: SeatState::new(&globals, &qh),
            compositor: CompositorState::bind(&globals, &qh)?,
            layer_shell,
            surfaces: HashMap::new(),
            pointer: None,
            hover: None,
            clicks: Vec::new(),
        };

        queue.roundtrip(&mut state)?;
        queue.roundtrip(&mut state)?;
        Ok(Self { conn, queue, qh, state, hypr: super::hyprland::Hyprland::connect() })
    }

    fn output_named(&self, name: &str) -> Option<wl_output::WlOutput> {
        self.state.outputs.outputs().find(|o| self.state.outputs.info(o).and_then(|i| i.name).as_deref() == Some(name))
    }
}

impl Backend for LayerShell {
    fn name(&self) -> &'static str {
        if self.hypr.is_some() { "hyprland" } else { "layershell" }
    }

    fn monitors(&mut self) -> anyhow::Result<Vec<Monitor>> {
        self.queue.roundtrip(&mut self.state)?;
        let mut out = Vec::new();
        for o in self.state.outputs.outputs() {
            let Some(i) = self.state.outputs.info(&o) else { continue };
            let scale = i.scale_factor.max(1);
            let (lx, ly) = i.logical_position.unwrap_or(i.location);
            let (lw, lh) = i.logical_size.unwrap_or_else(|| i.modes.iter().find(|m| m.current).map_or((0, 0), |m| (m.dimensions.0 / scale, m.dimensions.1 / scale)));

            out.push(Monitor {
                name: i.name.clone().unwrap_or_else(|| format!("output-{}", i.id)),
                x: lx * scale,
                y: ly * scale,
                width: (lw * scale) as u32,
                height: (lh * scale) as u32,
                scale: scale as f64,
                primary: false,
                wallpaper: None,
                span: None,
            });
        }

        out.sort_by_key(|m| (m.y, m.x));
        if let Some(i) = out.iter().position(|m| m.x == 0 && m.y == 0).or(if out.is_empty() { None } else { Some(0) }) {
            out[i].primary = true;
        }
        Ok(out)
    }

    fn create_surface(&mut self, key: &str, rect: Rect) -> anyhow::Result<SurfaceHandles> {
        self.destroy_surface(key);

        let output = self.output_named(key).ok_or_else(|| anyhow::anyhow!("{key}: spanning screens isn't possible on this compositor yet; set each screen on its own"))?;
        let scale = self.state.outputs.info(&output).map_or(1, |i| i.scale_factor.max(1));
        let surface = self.state.compositor.create_surface(&self.qh);
        surface.set_buffer_scale(scale);
        let layer = self.state.layer_shell.create_layer_surface(&self.qh, surface, Layer::Background, Some("zwall"), Some(&output));
        layer.set_anchor(Anchor::TOP | Anchor::BOTTOM | Anchor::LEFT | Anchor::RIGHT);
        layer.set_exclusive_zone(-1);
        layer.set_keyboard_interactivity(KeyboardInteractivity::None);
        layer.set_size(0, 0);
        layer.commit();
        self.state.surfaces.insert(key.to_string(), Surf { layer, rect, scale, configured: false });

        for _ in 0..50 {
            if self.state.surfaces[key].configured {
                break;
            }
            self.queue.blocking_dispatch(&mut self.state)?;
        }
        anyhow::ensure!(self.state.surfaces[key].configured, "{key}: the compositor didn't configure the wallpaper surface");
        let s = &self.state.surfaces[key];
        let display = NonNull::new(self.conn.backend().display_ptr().cast()).ok_or_else(|| anyhow::anyhow!("no wl_display"))?;
        let wl = NonNull::new(s.layer.wl_surface().id().as_ptr().cast()).ok_or_else(|| anyhow::anyhow!("no wl_surface"))?;
        Ok(SurfaceHandles {
            display: RawDisplayHandle::Wayland(WaylandDisplayHandle::new(display)),
            window: RawWindowHandle::Wayland(WaylandWindowHandle::new(wl)),
            native: wl.as_ptr() as u64,
        })
    }

    fn destroy_surface(&mut self, key: &str) {
        if self.state.surfaces.remove(key).is_some() {
            let _ = self.conn.flush();
        }
    }

    fn pump(&mut self) -> Input {
        let _ = self.conn.flush();
        if let Some(guard) = self.queue.prepare_read() {
            let _ = guard.read();
        }
        let _ = self.queue.dispatch_pending(&mut self.state);
        Input { clicks: std::mem::take(&mut self.state.clicks), hotkeys: Vec::new() }
    }

    fn pointer(&self) -> Option<Pointer> {
        if let Some(h) = &self.hypr {
            if let Some((x, y)) = h.cursor() {
                return Some(Pointer { x, y });
            }
        }
        self.state.hover.map(|(x, y)| Pointer { x, y })
    }

    fn fullscreen_active(&self) -> bool {
        self.hypr.as_ref().is_some_and(|h| h.fullscreen())
    }

    fn covered(&self, rect: Rect) -> Option<f32> {
        self.hypr.as_ref().and_then(|h| h.covered(rect))
    }
}

impl CompositorHandler for State {
    fn scale_factor_changed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: i32) {}
    fn transform_changed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: wl_output::Transform) {}
    fn frame(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: u32) {}
    fn surface_enter(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: &wl_output::WlOutput) {}
    fn surface_leave(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: &wl_output::WlOutput) {}
}

impl OutputHandler for State {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.outputs
    }
    fn new_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn update_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn output_destroyed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
}

impl LayerShellHandler for State {
    fn closed(&mut self, _: &Connection, _: &QueueHandle<Self>, layer: &LayerSurface) {
        self.surfaces.retain(|_, s| s.layer != *layer);
    }

    fn configure(&mut self, _: &Connection, _: &QueueHandle<Self>, layer: &LayerSurface, _: LayerSurfaceConfigure, _: u32) {
        if let Some(s) = self.surfaces.values_mut().find(|s| s.layer == *layer) {
            if !s.configured {
                s.configured = true;

                if let Ok(region) = Region::new(&self.compositor) {
                    region.add(0, 0, i32::MAX, i32::MAX);
                    layer.wl_surface().set_opaque_region(Some(region.wl_region()));
                }
            }
        }
    }
}

impl SeatHandler for State {
    fn seat_state(&mut self) -> &mut SeatState {
        &mut self.seat
    }
    fn new_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
    fn new_capability(&mut self, _: &Connection, qh: &QueueHandle<Self>, seat: wl_seat::WlSeat, cap: Capability) {
        if cap == Capability::Pointer && self.pointer.is_none() {
            self.pointer = self.seat.get_pointer(qh, &seat).ok();
        }
    }
    fn remove_capability(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat, cap: Capability) {
        if cap == Capability::Pointer {
            if let Some(p) = self.pointer.take() {
                p.release();
            }
        }
    }
    fn remove_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
}

impl PointerHandler for State {
    fn pointer_frame(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_pointer::WlPointer, events: &[PointerEvent]) {
        for e in events {
            let Some(s) = self.surfaces.values().find(|s| s.layer.wl_surface() == &e.surface) else { continue };
            let k = s.scale as f64;
            let g = (s.rect.x + (e.position.0 * k) as i32, s.rect.y + (e.position.1 * k) as i32);
            match e.kind {
                PointerEventKind::Enter { .. } | PointerEventKind::Motion { .. } => self.hover = Some(g),
                PointerEventKind::Leave { .. } => self.hover = None,
                PointerEventKind::Press { button, .. } if button == BTN_LEFT => self.clicks.push(g),
                _ => {}
            }
        }
    }
}

impl ProvidesRegistryState for State {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry
    }
    registry_handlers![OutputState, SeatState];
}

delegate_registry!(State);
smithay_client_toolkit::delegate_dispatch2!(State);
