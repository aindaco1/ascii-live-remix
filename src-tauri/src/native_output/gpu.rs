use super::{
    native_grid_dimensions, DecodedRgbFrame, NativeRenderParams, DEFAULT_OUTPUT_HEIGHT,
    DEFAULT_OUTPUT_WIDTH,
};
use std::borrow::Cow;
#[cfg(target_os = "macos")]
use std::ffi::c_void;
#[cfg(not(target_os = "macos"))]
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{PhysicalSize, Window};

const CELL_PASS_WGSL: &str = r#"
struct Params {
    srcW: u32,
    srcH: u32,
    cols: u32,
    rows: u32,
    cellW: u32,
    cellH: u32,
    saturationBoost: f32,
    contrastBoost: f32,
    brightness: f32,
    gamma: f32,
    bgBlend: f32,
    quantizeBits: u32,
    jitterAmount: f32,
    jitterSpeed: f32,
    sampleX: f32,
    sampleY: f32,
    time: f32,
    mirrorX: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var colorOut: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, vec3<f32>(p3.y + 33.33, p3.z + 33.33, p3.x + 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

fn processColor(c: vec3<f32>) -> vec3<f32> {
    let avg = (c.r + c.g + c.b) * 0.333333333;
    var outColor = vec3<f32>(
        clamp(avg + (c.r - avg) * params.saturationBoost, 0.0, 1.0),
        clamp(avg + (c.g - avg) * params.saturationBoost, 0.0, 1.0),
        clamp(avg + (c.b - avg) * params.saturationBoost, 0.0, 1.0)
    );
    outColor = clamp((outColor - vec3<f32>(0.5)) * params.contrastBoost + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
    outColor = clamp(pow(outColor * params.brightness, vec3<f32>(1.0 / max(0.01, params.gamma))), vec3<f32>(0.0), vec3<f32>(1.0));
    if (params.quantizeBits > 0u) {
        let quantum = pow(2.0, f32(params.quantizeBits));
        outColor = floor(outColor * 255.0 / quantum) * quantum / 255.0;
    }
    return mix(outColor, vec3<f32>(3.0 / 255.0, 4.0 / 255.0, 5.0 / 255.0), clamp(params.bgBlend, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let cx = gid.x;
    let cy = gid.y;
    if (cx >= params.cols || cy >= params.rows) { return; }

    let cellW = f32(params.srcW) / f32(params.cols);
    let cellH = f32(params.srcH) / f32(params.rows);
    let seed = vec2<f32>(f32(cx) + params.time * params.jitterSpeed * 7.13, f32(cy) + params.time * params.jitterSpeed * 11.71);
    let jitterX = (hash(seed) - 0.5) * cellW * params.jitterAmount;
    let jitterY = (hash(seed + vec2<f32>(37.0, 91.0)) - 0.5) * cellH * params.jitterAmount;
    let cellCenterX = (f32(cx) + params.sampleX) * f32(params.srcW) / f32(params.cols);
    let cellCenterY = (f32(cy) + params.sampleY) * f32(params.srcH) / f32(params.rows);
    var sampleX = clamp(i32(cellCenterX + jitterX), 0, i32(params.srcW) - 1);
    if (params.mirrorX != 0u) {
        sampleX = i32(params.srcW) - 1 - sampleX;
    }
    let sampleY = clamp(i32(cellCenterY + jitterY), 0, i32(params.srcH) - 1);

    let c = textureLoad(srcTex, vec2<i32>(sampleX, sampleY), 0);
    textureStore(colorOut, vec2<i32>(i32(cx), i32(cy)), vec4<f32>(processColor(c.rgb), 1.0));
}
"#;

const RENDER_PASS_WGSL: &str = r#"
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(3.0, 1.0)
    );

    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
    return output;
}

struct RenderParams {
    cols: u32,
    rows: u32,
    cellW: u32,
    cellH: u32,
    surfaceW: u32,
    surfaceH: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var cellColorTex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: RenderParams;

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let renderW = f32(params.cols * params.cellW);
    let renderH = f32(params.rows * params.cellH);
    let surfaceW = f32(params.surfaceW);
    let surfaceH = f32(params.surfaceH);
    let scale = max(surfaceW / renderW, surfaceH / renderH);
    let offsetX = (surfaceW - renderW * scale) * 0.5;
    let offsetY = (surfaceH - renderH * scale) * 0.5;
    let renderX = (position.x - offsetX) / scale;
    let renderY = (position.y - offsetY) / scale;

    if (renderX < 0.0 || renderY < 0.0 || renderX >= renderW || renderY >= renderH) {
        return vec4<f32>(3.0 / 255.0, 4.0 / 255.0, 5.0 / 255.0, 1.0);
    }

    let cx = min(u32(renderX) / params.cellW, params.cols - 1u);
    let cy = min(u32(renderY) / params.cellH, params.rows - 1u);
    return textureLoad(cellColorTex, vec2<i32>(i32(cx), i32(cy)), 0);
}
"#;

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn asciline_native_output_install_metal_view(host_view: *mut c_void) -> *mut c_void;
    fn asciline_native_output_metal_layer(output_view: *mut c_void) -> *mut c_void;
    fn asciline_native_output_resize_metal_view(output_view: *mut c_void);
    fn asciline_native_output_release_metal_view(output_view: *mut c_void);
}

#[cfg(target_os = "macos")]
struct NativeMetalView {
    view: usize,
    layer: usize,
}

#[cfg(target_os = "macos")]
unsafe impl Send for NativeMetalView {}

#[cfg(target_os = "macos")]
impl NativeMetalView {
    fn install(window: &Window) -> Result<Self, String> {
        let host_window = window
            .ns_window()
            .map_err(|error| format!("native Metal host window unavailable: {error}"))?;
        if host_window.is_null() {
            return Err("native Metal host window is null".to_string());
        }

        let output_view = unsafe { asciline_native_output_install_metal_view(host_window.cast()) };
        if output_view.is_null() {
            return Err("native Metal output view creation failed".to_string());
        }

        let layer = unsafe { asciline_native_output_metal_layer(output_view) };
        if layer.is_null() {
            unsafe {
                asciline_native_output_release_metal_view(output_view);
            }
            return Err("native Metal output view did not expose a CAMetalLayer".to_string());
        }

        Ok(Self {
            view: output_view as usize,
            layer: layer as usize,
        })
    }

    fn layer(&self) -> *mut c_void {
        self.layer as *mut c_void
    }

    fn resize(&self) {
        unsafe {
            asciline_native_output_resize_metal_view(self.view as *mut c_void);
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for NativeMetalView {
    fn drop(&mut self) {
        unsafe {
            asciline_native_output_release_metal_view(self.view as *mut c_void);
        }
    }
}

pub(super) struct NativeGpuPresenter {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    compute_pipeline: wgpu::ComputePipeline,
    render_pipeline: wgpu::RenderPipeline,
    params_buffer: wgpu::Buffer,
    render_params_buffer: wgpu::Buffer,
    source_texture: Option<wgpu::Texture>,
    source_view: Option<wgpu::TextureView>,
    source_size: (u32, u32),
    cell_texture: Option<wgpu::Texture>,
    cell_view: Option<wgpu::TextureView>,
    cell_size: (u32, u32),
    compute_bind_group: Option<wgpu::BindGroup>,
    render_bind_group: Option<wgpu::BindGroup>,
    rgba_frame: Vec<u8>,
    #[cfg(target_os = "macos")]
    metal_view: Option<NativeMetalView>,
}

#[derive(Debug, Clone, Copy)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) struct NativeGpuFrameOutcome {
    pub(super) surface_status: &'static str,
    pub(super) presented: bool,
    pub(super) timing: NativeGpuFrameTiming,
}

#[derive(Debug, Clone, Copy, Default)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) struct NativeGpuFrameTiming {
    pub(super) prep_ns: u64,
    pub(super) acquire_ns: u64,
    pub(super) encode_ns: u64,
    pub(super) submit_ns: u64,
    pub(super) present_ns: u64,
    pub(super) total_ns: u64,
}

impl NativeGpuPresenter {
    #[cfg(not(target_os = "macos"))]
    pub(super) fn new(window: &Window) -> Result<Self, String> {
        let (instance, surface) = create_surface_on_main_thread(window)?;
        Self::new_with_surface(window, instance, surface, wgpu::PresentMode::AutoNoVsync)
    }

    #[cfg(target_os = "macos")]
    pub(super) fn new_with_metal_view_on_current_thread(window: &Window) -> Result<Self, String> {
        let metal_view = NativeMetalView::install(window)?;
        let instance = wgpu::Instance::default();
        let surface = unsafe {
            instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(
                metal_view.layer(),
            ))
        }
        .map_err(|error| format!("native Metal layer surface creation failed: {error}"))?;
        let mut presenter =
            Self::new_with_surface(window, instance, surface, wgpu::PresentMode::AutoNoVsync)?;
        presenter.metal_view = Some(metal_view);
        Ok(presenter)
    }

    fn new_with_surface(
        window: &Window,
        instance: wgpu::Instance,
        surface: wgpu::Surface<'static>,
        present_mode: wgpu::PresentMode,
    ) -> Result<Self, String> {
        let size = window
            .inner_size()
            .unwrap_or_else(|_| PhysicalSize::new(DEFAULT_OUTPUT_WIDTH, DEFAULT_OUTPUT_HEIGHT));
        let width = size.width.max(1);
        let height = size.height.max(1);

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .map_err(|error| format!("native GPU adapter unavailable: {error}"))?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("ASCILINE native GPU device"),
            ..Default::default()
        }))
        .map_err(|error| format!("native GPU device unavailable: {error}"))?;

        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| "native GPU surface is not supported by adapter".to_string())?;
        config.present_mode = present_mode;
        config.desired_maximum_frame_latency = 3;
        surface.configure(&device, &config);

        let compute_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ASCILINE native GPU cell pass"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(CELL_PASS_WGSL)),
        });
        let render_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ASCILINE native GPU render pass"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(RENDER_PASS_WGSL)),
        });
        let compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("ASCILINE native GPU cell pipeline"),
            layout: None,
            module: &compute_module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ASCILINE native GPU render pipeline"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &render_module,
                entry_point: Some("vertexMain"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &render_module,
                entry_point: Some("fragmentMain"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: config.format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            multiview_mask: None,
            cache: None,
        });
        let params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ASCILINE native GPU params"),
            size: 80,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let render_params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ASCILINE native GPU render params"),
            size: 32,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Ok(Self {
            surface,
            device,
            queue,
            config,
            compute_pipeline,
            render_pipeline,
            params_buffer,
            render_params_buffer,
            source_texture: None,
            source_view: None,
            source_size: (0, 0),
            cell_texture: None,
            cell_view: None,
            cell_size: (0, 0),
            compute_bind_group: None,
            render_bind_group: None,
            rgba_frame: Vec::new(),
            #[cfg(target_os = "macos")]
            metal_view: None,
        })
    }

    #[cfg(not(target_os = "macos"))]
    pub(super) fn render_frame(
        &mut self,
        window: &Window,
        frame: &DecodedRgbFrame,
        params: &NativeRenderParams,
        frame_index: usize,
    ) -> Result<(), String> {
        self.render_frame_with_outcome(window, frame, params, frame_index)
            .map(|_| ())
    }

    pub(super) fn render_frame_with_outcome(
        &mut self,
        window: &Window,
        frame: &DecodedRgbFrame,
        params: &NativeRenderParams,
        frame_index: usize,
    ) -> Result<NativeGpuFrameOutcome, String> {
        let total_started_at = Instant::now();
        let prep_started_at = Instant::now();
        let surface_size = window
            .inner_size()
            .unwrap_or_else(|_| PhysicalSize::new(DEFAULT_OUTPUT_WIDTH, DEFAULT_OUTPUT_HEIGHT));
        let width = surface_size.width.max(1);
        let height = surface_size.height.max(1);
        #[cfg(target_os = "macos")]
        if self.metal_view.is_some() && (self.config.width != width || self.config.height != height)
        {
            if let Some(metal_view) = self.metal_view.as_ref() {
                metal_view.resize();
            }
        }
        self.configure_surface(width, height);

        let (cols, rows) = native_grid_dimensions(params, frame.width, frame.height);
        self.ensure_source_texture(frame)?;
        self.ensure_cell_texture(cols, rows);

        let source_view = self
            .source_view
            .as_ref()
            .ok_or_else(|| "native GPU source texture is unavailable".to_string())?;
        let cell_view = self
            .cell_view
            .as_ref()
            .ok_or_else(|| "native GPU cell texture is unavailable".to_string())?;
        if self.compute_bind_group.is_none() {
            self.compute_bind_group =
                Some(self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("ASCILINE native GPU compute bind group"),
                    layout: &self.compute_pipeline.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(source_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(cell_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 2,
                            resource: self.params_buffer.as_entire_binding(),
                        },
                    ],
                }));
        }
        if self.render_bind_group.is_none() {
            self.render_bind_group =
                Some(self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("ASCILINE native GPU render bind group"),
                    layout: &self.render_pipeline.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(cell_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: self.render_params_buffer.as_entire_binding(),
                        },
                    ],
                }));
        }

        self.queue.write_buffer(
            &self.params_buffer,
            0,
            &cell_params_bytes(frame, params, cols, rows, frame_index),
        );
        self.queue.write_buffer(
            &self.render_params_buffer,
            0,
            &render_params_bytes(params, cols, rows, self.config.width, self.config.height),
        );
        let prep_ns = duration_ns_u64(prep_started_at.elapsed());

        let acquire_started_at = Instant::now();
        let (output, surface_status) = self.current_surface_texture()?;
        let acquire_ns = duration_ns_u64(acquire_started_at.elapsed());
        let Some(output) = output else {
            return Ok(NativeGpuFrameOutcome {
                surface_status,
                presented: false,
                timing: NativeGpuFrameTiming {
                    prep_ns,
                    acquire_ns,
                    total_ns: duration_ns_u64(total_started_at.elapsed()),
                    ..Default::default()
                },
            });
        };
        let encode_started_at = Instant::now();
        let output_view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("ASCILINE native GPU frame"),
            });

        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("ASCILINE native GPU cell pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.compute_pipeline);
            pass.set_bind_group(0, self.compute_bind_group.as_ref().unwrap(), &[]);
            pass.dispatch_workgroups(cols.div_ceil(8), rows.div_ceil(8), 1);
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ASCILINE native GPU render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &output_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 3.0 / 255.0,
                            g: 4.0 / 255.0,
                            b: 5.0 / 255.0,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.render_pipeline);
            pass.set_bind_group(0, self.render_bind_group.as_ref().unwrap(), &[]);
            pass.draw(0..3, 0..1);
        }
        let encode_ns = duration_ns_u64(encode_started_at.elapsed());

        let submit_started_at = Instant::now();
        self.queue.submit(Some(encoder.finish()));
        let submit_ns = duration_ns_u64(submit_started_at.elapsed());
        let present_started_at = Instant::now();
        output.present();
        let present_ns = duration_ns_u64(present_started_at.elapsed());
        Ok(NativeGpuFrameOutcome {
            surface_status,
            presented: true,
            timing: NativeGpuFrameTiming {
                prep_ns,
                acquire_ns,
                encode_ns,
                submit_ns,
                present_ns,
                total_ns: duration_ns_u64(total_started_at.elapsed()),
            },
        })
    }

    fn current_surface_texture(
        &mut self,
    ) -> Result<(Option<wgpu::SurfaceTexture>, &'static str), String> {
        match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) => Ok((Some(texture), "success")),
            wgpu::CurrentSurfaceTexture::Suboptimal(texture) => Ok((Some(texture), "suboptimal")),
            wgpu::CurrentSurfaceTexture::Timeout => Ok((None, "timeout")),
            wgpu::CurrentSurfaceTexture::Occluded => Ok((None, "occluded")),
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                match self.surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(texture) => {
                        Ok((Some(texture), "outdated-success"))
                    }
                    wgpu::CurrentSurfaceTexture::Suboptimal(texture) => {
                        Ok((Some(texture), "outdated-suboptimal"))
                    }
                    wgpu::CurrentSurfaceTexture::Timeout => Ok((None, "outdated-timeout")),
                    wgpu::CurrentSurfaceTexture::Occluded => Ok((None, "outdated-occluded")),
                    status => Err(format!("native GPU surface frame unavailable: {status:?}")),
                }
            }
            status => Err(format!("native GPU surface frame unavailable: {status:?}")),
        }
    }

    fn configure_surface(&mut self, width: u32, height: u32) {
        if self.config.width == width && self.config.height == height {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
    }

    fn ensure_source_texture(&mut self, frame: &DecodedRgbFrame) -> Result<(), String> {
        if self.source_size != (frame.width, frame.height) {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("ASCILINE native GPU source texture"),
                size: wgpu::Extent3d {
                    width: frame.width,
                    height: frame.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            self.source_view = Some(texture.create_view(&wgpu::TextureViewDescriptor::default()));
            self.source_texture = Some(texture);
            self.source_size = (frame.width, frame.height);
            self.compute_bind_group = None;
        }

        let expected_rgb_len = frame.width as usize * frame.height as usize * 3;
        if frame.data.len() < expected_rgb_len {
            return Err("native GPU source frame has too few RGB bytes".to_string());
        }
        let expected_rgba_len = frame.width as usize * frame.height as usize * 4;
        if self.rgba_frame.len() != expected_rgba_len {
            self.rgba_frame.resize(expected_rgba_len, 255);
        }
        for (rgb, rgba) in frame.data[..expected_rgb_len]
            .chunks_exact(3)
            .zip(self.rgba_frame.chunks_exact_mut(4))
        {
            rgba[0] = rgb[0];
            rgba[1] = rgb[1];
            rgba[2] = rgb[2];
            rgba[3] = 255;
        }

        let texture = self
            .source_texture
            .as_ref()
            .ok_or_else(|| "native GPU source texture is unavailable".to_string())?;
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &self.rgba_frame,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(frame.width * 4),
                rows_per_image: Some(frame.height),
            },
            wgpu::Extent3d {
                width: frame.width,
                height: frame.height,
                depth_or_array_layers: 1,
            },
        );
        Ok(())
    }

    fn ensure_cell_texture(&mut self, cols: u32, rows: u32) {
        if self.cell_size == (cols, rows) {
            return;
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ASCILINE native GPU cell color texture"),
            size: wgpu::Extent3d {
                width: cols,
                height: rows,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        });
        self.cell_view = Some(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        self.cell_texture = Some(texture);
        self.cell_size = (cols, rows);
        self.compute_bind_group = None;
        self.render_bind_group = None;
    }
}

#[cfg(not(target_os = "macos"))]
fn create_surface_on_main_thread(
    window: &Window,
) -> Result<(wgpu::Instance, wgpu::Surface<'static>), String> {
    let (tx, rx) = mpsc::sync_channel(1);
    let window_for_surface = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let instance = wgpu::Instance::default();
                let surface = instance
                    .create_surface(window_for_surface)
                    .map_err(|error| format!("native GPU surface unavailable: {error}"))?;
                Ok((instance, surface))
            })();
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|error| format!("native GPU surface init timed out: {error}"))?
}

fn duration_ns_u64(duration: Duration) -> u64 {
    duration.as_nanos().min(u128::from(u64::MAX)) as u64
}

fn cell_params_bytes(
    frame: &DecodedRgbFrame,
    params: &NativeRenderParams,
    cols: u32,
    rows: u32,
    frame_index: usize,
) -> [u8; 80] {
    let mut bytes = [0u8; 80];
    put_u32(&mut bytes, 0, frame.width);
    put_u32(&mut bytes, 4, frame.height);
    put_u32(&mut bytes, 8, cols);
    put_u32(&mut bytes, 12, rows);
    put_u32(&mut bytes, 16, (frame.width / cols.max(1)).max(1));
    put_u32(&mut bytes, 20, (frame.height / rows.max(1)).max(1));
    put_f32(&mut bytes, 24, params.saturation_boost as f32);
    put_f32(&mut bytes, 28, params.contrast_boost as f32);
    put_f32(&mut bytes, 32, params.brightness as f32);
    put_f32(&mut bytes, 36, params.gamma as f32);
    put_f32(&mut bytes, 40, params.bg_blend as f32);
    put_u32(&mut bytes, 44, params.quantize_bits);
    put_f32(&mut bytes, 48, params.jitter_amount as f32);
    put_f32(&mut bytes, 52, params.jitter_speed as f32);
    put_f32(&mut bytes, 56, params.sample_x as f32);
    put_f32(&mut bytes, 60, params.sample_y as f32);
    put_f32(
        &mut bytes,
        64,
        (frame_index as f64 / params.fps.max(1.0)) as f32,
    );
    put_u32(&mut bytes, 68, u32::from(params.mirror_x));
    bytes
}

fn render_params_bytes(
    params: &NativeRenderParams,
    cols: u32,
    rows: u32,
    surface_width: u32,
    surface_height: u32,
) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    put_u32(&mut bytes, 0, cols);
    put_u32(&mut bytes, 4, rows);
    put_u32(&mut bytes, 8, params.cell_width.max(1));
    put_u32(&mut bytes, 12, params.cell_height.max(1));
    put_u32(&mut bytes, 16, surface_width.max(1));
    put_u32(&mut bytes, 20, surface_height.max(1));
    bytes
}

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_f32(bytes: &mut [u8], offset: usize, value: f32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cell_params_match_webgpu_uniform_layout() {
        let params = NativeRenderParams {
            loop_media: true,
            cols: 80,
            rows: 0,
            auto_rows: true,
            fps: 24.0,
            saturation_boost: 1.4,
            contrast_boost: 1.2,
            brightness: 1.0,
            gamma: 1.0,
            bg_blend: 0.3,
            quantize_bits: 2,
            jitter_amount: 0.6,
            jitter_speed: 1.0,
            sample_x: 0.5,
            sample_y: 0.5,
            cell_width: 2,
            cell_height: 3,
            aspect_correction: 1.0,
            mirror_x: true,
            pixel: false,
            solid_mode: false,
            native_wtf_active: false,
            audio_reactive_active: false,
            audio_reactive_source: String::new(),
            audio_reactive_preset: "pulse-reactor".to_string(),
            audio_reactive_sensitivity: 7.5,
            audio_reactive_beat_amount: 1.68,
            audio_reactive_bass_amount: 1.25,
            audio_reactive_mid_amount: 1.14,
            audio_reactive_treble_amount: 1.16,
        };
        let frame = DecodedRgbFrame {
            index: 0,
            width: 640,
            height: 360,
            data: vec![0; 640 * 360 * 3],
        };
        let bytes = cell_params_bytes(&frame, &params, 80, 45, 12);

        assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()), 640);
        assert_eq!(u32::from_le_bytes(bytes[8..12].try_into().unwrap()), 80);
        assert_eq!(u32::from_le_bytes(bytes[44..48].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(bytes[68..72].try_into().unwrap()), 1);
        assert_eq!(bytes.len(), 80);
    }
}
