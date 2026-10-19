use anyhow::{anyhow, bail, Context};
use raw_window_handle::{RawDisplayHandle, RawWindowHandle};
use std::{path::Path, time::Instant};

pub const COMMON: &str = include_str!("../shaders/common.wgsl");

pub const COMMON_VERSION: &str = COMMON;

pub const PRESETS: &[(&str, &str)] = &[
    ("aurora", include_str!("../shaders/aurora.wgsl")),
    ("starfield", include_str!("../shaders/starfield.wgsl")),
    ("rain", include_str!("../shaders/rain.wgsl")),
    ("lava", include_str!("../shaders/lava.wgsl")),
    ("fireflies", include_str!("../shaders/fireflies.wgsl")),
    ("mesh", include_str!("../shaders/mesh.wgsl")),
    ("dunes", include_str!("../shaders/dunes.wgsl")),
    ("ocean", include_str!("../shaders/ocean.wgsl")),
    ("snow", include_str!("../shaders/snow.wgsl")),
    ("ink", include_str!("../shaders/ink.wgsl")),
    ("grain", include_str!("../shaders/grain.wgsl")),
    ("crt", include_str!("../shaders/crt.wgsl")),
];
pub const PHOTO: &str = include_str!("../shaders/photo.wgsl");

pub const LAYERS: &[(&str, &str)] = &[
    ("rain", include_str!("../shaders/layers/rain.wgsl")),
    ("snow", include_str!("../shaders/layers/snow.wgsl")),
    ("fireflies", include_str!("../shaders/layers/fireflies.wgsl")),
    ("grain", include_str!("../shaders/layers/grain.wgsl")),
];
const BLIT: &str = include_str!("../shaders/blit.wgsl");

const IMAGE_EXT: &[&str] = &["jpg", "jpeg", "png", "webp"];
const VIDEO_EXT: &[&str] = &["mp4", "webm", "mkv", "mov", "gif"];

pub enum Source {
    Shader(&'static str),

    Image(image::RgbaImage, Option<image::GrayImage>, Option<image::RgbaImage>),
}

impl Source {
    pub fn load_with_depth(path: &str, depth: Option<&str>) -> anyhow::Result<Self> {
        Self::load_photo(path, depth, None)
    }

    pub fn load_photo(path: &str, depth: Option<&str>, motion: Option<&str>) -> anyhow::Result<Self> {
        match Self::load(path)? {
            Source::Image(img, _, _) => Ok(Source::Image(
                img,
                depth.and_then(|d| image::open(d).ok()).map(|d| d.to_luma8()),
                motion.and_then(|m| image::open(m).ok()).map(|m| m.to_rgba8()),
            )),
            other => Ok(other),
        }
    }

    pub fn load(path: &str) -> anyhow::Result<Self> {
        if let Some(name) = path.strip_prefix("preset://") {
            return PRESETS.iter().find(|(n, _)| *n == name).map(|(_, s)| Source::Shader(s)).ok_or_else(|| anyhow!("unknown preset {name}"));
        }
        let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if IMAGE_EXT.contains(&ext.as_str()) {
            let img = image::open(path).with_context(|| format!("could not open {path}"))?;

            let img = if img.width() > 8192 || img.height() > 8192 { img.thumbnail(8192, 8192) } else { img };
            return Ok(Source::Image(img.to_rgba8(), None, None));
        }
        if VIDEO_EXT.contains(&ext.as_str()) {
            bail!("videos play through the engine's video player, not the GPU renderer");
        }
        if is_web(path) {
            bail!("HTML wallpapers play through KDE Plasma; this desktop can't show them yet");
        }
        if ext == "zwall" {
            bail!(".zwall playback arrives with the library (M4)");
        }
        bail!("ZWall can't play .{ext} files")
    }
}

#[derive(Debug, Clone, Copy)]
pub struct FrameInputs {
    pub canvas: [f32; 2],
    pub origin: [f32; 2],

    pub cursor: [f32; 2],
    pub speed: f32,
    pub intensity: f32,
    pub depth: f32,

    pub tint: [f32; 4],

    pub ripple: [f32; 4],

    pub grade: [f32; 3],

    pub layer_amount: f32,

    pub life: f32,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    resolution: [f32; 2],
    canvas: [f32; 2],
    origin: [f32; 2],
    cursor: [f32; 2],
    time: f32,
    speed: f32,
    intensity: f32,
    depth: f32,
    tint: [f32; 4],
    ripple: [f32; 4],
    grade: [f32; 4],
}

struct Device {
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
}

pub struct Gpu {
    instance: wgpu::Instance,
    dev: Option<Device>,
}

impl Default for Gpu {
    fn default() -> Self {
        Self::new()
    }
}

impl Gpu {
    pub fn new() -> Self {
        let desc = wgpu::InstanceDescriptor { backends: wgpu::Backends::PRIMARY, ..wgpu::InstanceDescriptor::new_without_display_handle() };
        Self { instance: wgpu::Instance::new(desc), dev: None }
    }

    #[allow(clippy::missing_safety_doc)]
    pub unsafe fn create_surface(&self, display: RawDisplayHandle, window: RawWindowHandle) -> anyhow::Result<wgpu::Surface<'static>> {
        let target = wgpu::SurfaceTargetUnsafe::RawHandle { raw_display_handle: Some(display), raw_window_handle: window };
        Ok(unsafe { self.instance.create_surface_unsafe(target) }?)
    }

    pub fn adapter_name(&mut self) -> Option<String> {
        self.device(None).ok().map(|d| d.adapter.get_info().name)
    }

    fn device(&mut self, surface: Option<&wgpu::Surface>) -> anyhow::Result<&Device> {
        if self.dev.is_none() {
            let adapter = pollster::block_on(self.instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                compatible_surface: surface,
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            }))?;
            log::info!("gpu: {}", adapter.get_info().name);
            let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { label: Some("zwall"), ..Default::default() }))?;
            self.dev = Some(Device { adapter, device, queue });
        }
        Ok(self.dev.as_ref().unwrap())
    }
}

struct Pipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    uniforms: wgpu::Buffer,
}

impl Pipeline {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue, source: &Source, format: wgpu::TextureFormat) -> Self {
        Self::with_blend(device, queue, source, format, None)
    }

    fn layer(device: &wgpu::Device, queue: &wgpu::Queue, wgsl: &'static str, format: wgpu::TextureFormat) -> Self {
        Self::with_blend(device, queue, &Source::Shader(wgsl), format, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING))
    }

    fn with_blend(device: &wgpu::Device, queue: &wgpu::Queue, source: &Source, format: wgpu::TextureFormat, blend: Option<wgpu::BlendState>) -> Self {
        let uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("frame"),
            size: std::mem::size_of::<Uniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut layout_entries = vec![wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
            count: None,
        }];
        let (code, texture) = match source {
            Source::Shader(s) => (format!("{COMMON}\n{s}"), None),
            Source::Image(img, depth, motion) => {
                for binding in [1, 3, 4] {
                    layout_entries.push(wgpu::BindGroupLayoutEntry {
                        binding,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                        count: None,
                    });
                }
                layout_entries.push(wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None });

                let flat = image::GrayImage::from_pixel(1, 1, image::Luma([102]));
                let depth_view = upload_gray(device, queue, depth.as_ref().unwrap_or(&flat));

                let still = image::RgbaImage::from_pixel(1, 1, image::Rgba([0, 0, 0, 255]));
                let motion_view = upload(device, queue, motion.as_ref().unwrap_or(&still));
                (format!("{COMMON}\n{PHOTO}"), Some((upload(device, queue, img), depth_view, motion_view)))
            }
        };
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("wallpaper"), source: wgpu::ShaderSource::Wgsl(code.into()) });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: None, entries: &layout_entries });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let mut entries = vec![wgpu::BindGroupEntry { binding: 0, resource: uniforms.as_entire_binding() }];
        if let Some((view, depth, motion)) = &texture {
            entries.push(wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view) });
            entries.push(wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&sampler) });
            entries.push(wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(depth) });
            entries.push(wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(motion) });
        }
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &bgl, entries: &entries });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&bgl)], immediate_size: 0 });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("wallpaper"),
            layout: Some(&layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs_main"), buffers: &[], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        Self { pipeline, bind_group, uniforms }
    }

    fn draw(&self, device: &wgpu::Device, queue: &wgpu::Queue, view: &wgpu::TextureView, u: &Uniforms) -> wgpu::CommandEncoder {
        let mut enc = device.create_command_encoder(&Default::default());
        self.encode(queue, &mut enc, view, u, true);
        enc
    }

    fn encode(&self, queue: &wgpu::Queue, enc: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, u: &Uniforms, clear: bool) {
        queue.write_buffer(&self.uniforms, 0, bytemuck::bytes_of(u));
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: if clear { wgpu::LoadOp::Clear(wgpu::Color::BLACK) } else { wgpu::LoadOp::Load }, store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
    }
}

fn uniforms(size: [f32; 2], time: f32, f: &FrameInputs, scale: f32) -> Uniforms {
    let s2 = |v: [f32; 2]| [v[0] * scale, v[1] * scale];
    let ripple = [f.ripple[0] * scale, f.ripple[1] * scale, f.ripple[2], f.ripple[3]];

    let grade = [f.grade[0], f.grade[1], f.grade[2], f.life];
    Uniforms { resolution: size, canvas: s2(f.canvas), origin: s2(f.origin), cursor: f.cursor, time, speed: 1.0, intensity: f.intensity, depth: f.depth, tint: f.tint, ripple, grade }
}

struct Downscale {
    scale: f32,
    size: [u32; 2],
    view: wgpu::TextureView,
    blit: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
}

impl Downscale {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat, full: [u32; 2], scale: f32) -> Self {
        let size = [((full[0] as f32 * scale) as u32).max(1), ((full[1] as f32 * scale) as u32).max(1)];
        let tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("reduced"),
            size: wgpu::Extent3d { width: size[0], height: size[1], depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = tex.create_view(&Default::default());
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("blit"), source: wgpu::ShaderSource::Wgsl(BLIT.into()) });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) }, wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) }],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&bgl)], immediate_size: 0 });
        let blit = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("blit"),
            layout: Some(&layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs_main"), buffers: &[], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        Self { scale, size, view, blit, bind_group }
    }

    fn blit(&self, enc: &mut wgpu::CommandEncoder, target: &wgpu::TextureView) {
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.blit);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.draw(0..3, 0..1);
    }
}

pub struct Scene {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    pipeline: Pipeline,

    layer: Option<(&'static str, Pipeline)>,
    downscale: Option<Downscale>,
    last: Instant,

    clock: f32,
}

impl Scene {
    pub fn new(gpu: &mut Gpu, surface: wgpu::Surface<'static>, width: u32, height: u32, source: &Source) -> anyhow::Result<Self> {
        let Device { adapter, device, queue } = gpu.device(Some(&surface))?;
        let caps = surface.get_capabilities(adapter);
        let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).or(caps.formats.first().copied()).context("surface has no formats")?;
        let present_mode = if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) { wgpu::PresentMode::Mailbox } else { wgpu::PresentMode::Fifo };
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: width.max(1),
            height: height.max(1),
            present_mode,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            color_space: wgpu::SurfaceColorSpace::Auto,
        };
        surface.configure(device, &config);
        let pipeline = Pipeline::new(device, queue, source, format);
        Ok(Self { surface, config, pipeline, layer: None, downscale: None, last: Instant::now(), clock: 0.0 })
    }

    pub fn size(&self) -> (u32, u32) {
        (self.config.width, self.config.height)
    }

    pub fn set_layer(&mut self, gpu: &Gpu, name: Option<&str>) {
        let current = self.layer.as_ref().map(|(n, _)| *n);
        if current == name {
            return;
        }
        self.layer = match (name.and_then(|n| LAYERS.iter().find(|(l, _)| *l == n)), &gpu.dev) {
            (Some((n, src)), Some(dev)) => Some((*n, Pipeline::layer(&dev.device, &dev.queue, src, self.config.format))),
            _ => None,
        };
    }

    pub fn set_quality(&mut self, gpu: &Gpu, quality: f32) {
        let q = quality.clamp(0.25, 1.0);
        if (q - 1.0).abs() < 0.01 {
            self.downscale = None;
        } else if self.downscale.as_ref().is_none_or(|d| (d.scale - q).abs() > 0.01) {
            if let Some(dev) = &gpu.dev {
                self.downscale = Some(Downscale::new(&dev.device, self.config.format, [self.config.width, self.config.height], q));
            }
        }
    }

    pub fn render(&mut self, gpu: &Gpu, f: &FrameInputs) -> anyhow::Result<()> {
        let Some(Device { device, queue, .. }) = &gpu.dev else { bail!("no device") };
        let now = Instant::now();

        let dt = now.duration_since(self.last).as_secs_f32().min(0.1);
        self.last = now;
        self.clock = (self.clock + dt * f.speed) % 3600.0;
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(device, &self.config);
                return Ok(());
            }

            _ => return Ok(()),
        };
        let view = frame.texture.create_view(&Default::default());
        let (target, size, scale) = match &self.downscale {
            None => (&view, [self.config.width as f32, self.config.height as f32], 1.0),
            Some(d) => (&d.view, [d.size[0] as f32, d.size[1] as f32], d.scale),
        };
        let mut enc = self.pipeline.draw(device, queue, target, &uniforms(size, self.clock, f, scale));
        if let Some((_, layer)) = &self.layer {
            let lf = FrameInputs { intensity: f.layer_amount, ..*f };
            layer.encode(queue, &mut enc, target, &uniforms(size, self.clock, &lf, scale), false);
        }
        if let Some(d) = &self.downscale {
            d.blit(&mut enc, &view);
        }
        queue.submit([enc.finish()]);
        queue.present(frame);
        Ok(())
    }
}

pub fn snapshot(gpu: &mut Gpu, source: &Source, width: u32, height: u32, time: f32) -> anyhow::Result<image::RgbaImage> {
    let Device { device, queue, .. } = gpu.device(None)?;
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("snapshot"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let pipeline = Pipeline::new(device, queue, source, format);
    let f = FrameInputs { canvas: [width as f32, height as f32], origin: [0.0; 2], cursor: [0.0; 2], speed: 1.0, intensity: 1.0, depth: 1.0, tint: [0.0; 4], ripple: [0.0; 4], grade: [1.0; 3], layer_amount: 1.0, life: 1.0 };
    let view = target.create_view(&Default::default());
    let mut enc = pipeline.draw(device, queue, &view, &uniforms([width as f32, height as f32], time, &f, 1.0));

    let row = (width * 4).div_ceil(256) * 256;
    let buf = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (row * height) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo { texture: &target, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) } },
        size,
    );
    queue.submit([enc.finish()]);
    let slice = buf.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| drop(tx.send(r)));
    device.poll(wgpu::PollType::wait_indefinitely())?;
    rx.recv()??;
    let data = slice.get_mapped_range().map_err(|e| anyhow!("{e:?}"))?;
    let mut img = image::RgbaImage::new(width, height);
    for y in 0..height {
        let src = &data[(y * row) as usize..(y * row + width * 4) as usize];
        img.as_mut()[(y * width * 4) as usize..((y + 1) * width * 4) as usize].copy_from_slice(src);
    }
    Ok(img)
}

fn upload_gray(device: &wgpu::Device, queue: &wgpu::Queue, img: &image::GrayImage) -> wgpu::TextureView {
    let size = wgpu::Extent3d { width: img.width(), height: img.height(), depth_or_array_layers: 1 };
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("depth"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::R8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });

    let row = img.width().div_ceil(256) * 256;
    let mut padded = vec![0u8; (row * img.height()) as usize];
    for y in 0..img.height() {
        let src = &img.as_raw()[(y * img.width()) as usize..((y + 1) * img.width()) as usize];
        padded[(y * row) as usize..(y * row + img.width()) as usize].copy_from_slice(src);
    }
    queue.write_texture(
        wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        &padded,
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(img.height()) },
        size,
    );
    tex.create_view(&Default::default())
}

fn upload(device: &wgpu::Device, queue: &wgpu::Queue, img: &image::RgbaImage) -> wgpu::TextureView {
    let size = wgpu::Extent3d { width: img.width(), height: img.height(), depth_or_array_layers: 1 };
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("photo"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,

        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        img.as_raw(),
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(4 * img.width()), rows_per_image: Some(img.height()) },
        size,
    );
    tex.create_view(&Default::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_valid_wgsl() {
        for (name, src) in PRESETS.iter().copied().chain(LAYERS.iter().copied()).chain([("photo", PHOTO), ("blit", "")]) {
            let code = if name == "blit" { BLIT.to_string() } else { format!("{COMMON}\n{src}") };
            let module = naga::front::wgsl::parse_str(&code).unwrap_or_else(|e| panic!("{name}: {}", e.emit_to_string(&code)));
            naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::all())
                .validate(&module)
                .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        }
    }

    #[test]
    fn resolves_paths() {
        assert!(matches!(Source::load("preset://aurora"), Ok(Source::Shader(_))));
        assert!(Source::load("preset://nope").is_err());
        assert!(Source::load("/x/clip.mp4").is_err());
    }
}

pub fn is_web(path: &str) -> bool {
    let p = Path::new(path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    ext == "html" || ext == "htm" || p.join("index.html").is_file()
}

pub fn web_entry(path: &str) -> String {
    let p = Path::new(path);
    if p.is_dir() { p.join("index.html").to_string_lossy().into_owned() } else { path.to_string() }
}

pub fn is_video(path: &str) -> bool {
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    VIDEO_EXT.contains(&ext.as_str())
}
pub use image;
