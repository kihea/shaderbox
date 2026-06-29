import type {
  EngineCallbacks,
  IEngine,
  ImageAsset,
  Pass,
  Project,
  ShaderError,
} from "./types";
import { NUM_CHANNELS } from "./types";
import { buildUniformLayout, packUniforms, type UniformLayout } from "./uniforms";

const BLIT_SHADER = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[vi];
  var out: VOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = xy * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}
@fragment
fn fs(in: VOut) -> @location(0) vec4f { return textureSampleLevel(src, samp, in.uv, 0.0); }
`;

const FRAGMENT_PRELUDE_VS = `struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[vi];
  var out: VertexOutput;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = xy * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}
`;

const BUFFER_FORMAT: GPUTextureFormat = "rgba8unorm";

interface GPUPass {
  passId: string;
  type: Pass["type"];
  pipeline: GPURenderPipeline | GPUComputePipeline | null;
  uniformBuffer: GPUBuffer;
  sig: string;
  tex?: [GPUTexture, GPUTexture];
  read: number;
  size: [number, number];
}

interface GPUImage {
  tex: GPUTexture;
  width: number;
  height: number;
  src: string;
}

export class WebGPUEngine implements IEngine {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private cb: EngineCallbacks;

  private project: Project | null = null;
  private layout: UniformLayout | null = null;
  private customValues: Record<string, number[]> = {};

  private renderBGL!: GPUBindGroupLayout;
  private computeBGL!: GPUBindGroupLayout;
  private sampler!: GPUSampler;
  private dummyView!: GPUTextureView;
  private blitPipeline: GPURenderPipeline | null = null;

  private passes = new Map<string, GPUPass>();
  private images = new Map<string, GPUImage>();

  private raf = 0;
  private startTime = 0;
  private lastFrameTime = 0;
  private pausedAt = 0;
  private paused = false;
  private frame = 0;
  private mouse: [number, number, number, number] = [0, 0, 0, 0];
  private fpsAccum = 0;
  private fpsCount = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks = {}) {
    this.canvas = canvas;
    this.cb = cb;
    this.attachMouse();
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  async init(): Promise<void> {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No suitable GPU adapter found.");
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      if (!this.disposed) {
        this.cb.onErrors?.([{ message: `GPU device lost: ${info.message}`, type: "error" }]);
      }
    });

    const ctx = this.canvas.getContext("webgpu");
    if (!ctx) throw new Error("Could not get a WebGPU canvas context.");
    this.context = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" });

    this.sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const dummy = this.device.createTexture({
      size: [1, 1],
      format: BUFFER_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.dummyView = dummy.createView();
    this.buildLayouts();

    this.resize();
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.loop();
  }

  private buildLayouts(): void {
    const d = this.device;
    const texEntries = (vis: number, start: number): GPUBindGroupLayoutEntry[] =>
      Array.from({ length: NUM_CHANNELS }, (_, i) => ({
        binding: start + i,
        visibility: vis,
        texture: { sampleType: "float", viewDimension: "2d" },
      }));
    const RV = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.renderBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: RV, buffer: { type: "uniform" } },
        { binding: 1, visibility: RV, sampler: { type: "filtering" } },
        ...texEntries(RV, 2),
      ],
    });
    const C = GPUShaderStage.COMPUTE;
    // Channels are rgba8unorm (filterable), and we bind a linear/filtering
    // sampler, so the compute layout must match the render layout's filtering
    // sampler + float textures — only the visibility and the extra storage
    // binding differ.
    this.computeBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: "uniform" } },
        { binding: 1, visibility: C, sampler: { type: "filtering" } },
        ...texEntries(C, 2),
        {
          binding: 6,
          visibility: C,
          storageTexture: { access: "write-only", format: BUFFER_FORMAT, viewDimension: "2d" },
        },
      ],
    });
  }

  resize(): void {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    // resize buffer targets on next setProject pass; force recreation now
    for (const gp of this.passes.values()) gp.size = [0, 0];
    if (this.project) this.setProject(this.project);
  }

  async setProject(project: Project): Promise<void> {
    if (this.disposed || !this.device) return;
    const layoutChanged =
      !this.layout ||
      !this.project ||
      JSON.stringify(this.project.uniforms.map((u) => [u.name, u.type])) !==
        JSON.stringify(project.uniforms.map((u) => [u.name, u.type]));

    this.project = project;
    this.customValues = {};
    for (const u of project.uniforms) this.customValues[u.name] = u.value;
    if (layoutChanged || !this.layout) this.layout = buildUniformLayout(project.uniforms);

    this.syncImages(project.images);

    const errors: ShaderError[] = [];
    const liveIds = new Set(project.passes.map((p) => p.id));
    for (const [id, gp] of this.passes) {
      if (!liveIds.has(id)) {
        this.destroyTargets(gp);
        gp.uniformBuffer.destroy();
        this.passes.delete(id);
      }
    }

    this.device.pushErrorScope("validation");
    for (let i = 0; i < project.passes.length; i++) {
      await this.ensurePass(project.passes[i], i === project.passes.length - 1, layoutChanged, errors);
    }
    try {
      const scoped = await this.device.popErrorScope();
      if (scoped && !this.disposed) errors.push({ message: scoped.message, type: "error" });
    } catch {
      /* device/instance lost during teardown */
    }
    this.cb.onErrors?.(errors);
  }

  setUniformValue(name: string, value: number[]): void {
    this.customValues[name] = value;
  }

  setPaused(p: boolean): void {
    if (p === this.paused) return;
    const now = performance.now();
    if (p) this.pausedAt = now;
    else {
      const delta = now - this.pausedAt;
      this.startTime += delta;
      this.lastFrameTime += delta;
    }
    this.paused = p;
  }

  resetTime(): void {
    const now = performance.now();
    this.startTime = now;
    this.lastFrameTime = now;
    this.pausedAt = now;
    this.frame = 0;
  }

  private attachMouse(): void {
    const rect = () => this.canvas.getBoundingClientRect();
    this.canvas.addEventListener("pointermove", (e) => {
      const r = rect();
      this.mouse[0] = (e.clientX - r.left) * this.dpr;
      this.mouse[1] = this.canvas.height - (e.clientY - r.top) * this.dpr;
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      const r = rect();
      this.mouse[2] = (e.clientX - r.left) * this.dpr;
      this.mouse[3] = this.canvas.height - (e.clientY - r.top) * this.dpr;
    });
  }

  // ----------------------------------------------------------------- images
  private syncImages(assets: ImageAsset[]): void {
    const live = new Set(assets.map((a) => a.id));
    for (const [id, img] of this.images) {
      if (!live.has(id)) {
        img.tex.destroy();
        this.images.delete(id);
      }
    }
    for (const a of assets) {
      const existing = this.images.get(a.id);
      if (existing && existing.src === a.dataUrl) continue;
      const rec: GPUImage =
        existing ?? { tex: this.makePlaceholder(), width: 1, height: 1, src: "" };
      rec.src = a.dataUrl;
      this.images.set(a.id, rec);
      this.loadImage(a, rec);
    }
  }

  private makePlaceholder(): GPUTexture {
    return this.device.createTexture({
      size: [1, 1],
      format: BUFFER_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private async loadImage(asset: ImageAsset, rec: GPUImage): Promise<void> {
    try {
      const res = await fetch(asset.dataUrl);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob, { imageOrientation: "flipY" });
      if (this.disposed) return;
      rec.tex.destroy();
      rec.tex = this.device.createTexture({
        size: [bitmap.width, bitmap.height],
        format: BUFFER_FORMAT,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: rec.tex },
        [bitmap.width, bitmap.height],
      );
      rec.width = bitmap.width;
      rec.height = bitmap.height;
    } catch {
      /* leave placeholder */
    }
  }

  // ----------------------------------------------------------------- passes
  private buildModuleSource(pass: Pass): { code: string; preludeLines: number } {
    const struct = this.layout!.wgslStruct;
    let prelude = `${struct}\n@group(0) @binding(0) var<uniform> u: Uniforms;\n`;
    prelude += "@group(0) @binding(1) var iSampler: sampler;\n";
    for (let i = 0; i < NUM_CHANNELS; i++) {
      prelude += `@group(0) @binding(${2 + i}) var iChannel${i}: texture_2d<f32>;\n`;
    }
    if (pass.type === "compute") {
      prelude += `@group(0) @binding(6) var outImage: texture_storage_2d<${BUFFER_FORMAT}, write>;\n`;
    } else if (pass.type === "fragment") {
      prelude += FRAGMENT_PRELUDE_VS + "\n";
    }
    return { code: prelude + pass.code, preludeLines: prelude.split("\n").length - 1 };
  }

  private async ensurePass(
    pass: Pass,
    isScreen: boolean,
    layoutChanged: boolean,
    errors: ShaderError[],
  ): Promise<void> {
    let gp = this.passes.get(pass.id);
    if (!gp) {
      gp = {
        passId: pass.id,
        type: pass.type,
        pipeline: null,
        uniformBuffer: this.device.createBuffer({
          size: this.layout!.byteSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        sig: "",
        read: 0,
        size: [0, 0],
      };
      this.passes.set(pass.id, gp);
    }
    // uniform buffer may need resizing when custom uniforms changed
    if (gp.uniformBuffer.size !== this.layout!.byteSize) {
      gp.uniformBuffer.destroy();
      gp.uniformBuffer = this.device.createBuffer({
        size: this.layout!.byteSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    if (!isScreen) this.ensureTargets(gp);
    else this.destroyTargets(gp);

    const want = `${pass.type}::${isScreen}::${this.layout!.wgslStruct}::${pass.code}`;
    if (gp.pipeline && gp.sig === want && !layoutChanged) {
      gp.type = pass.type;
      return;
    }

    const { code, preludeLines } = this.buildModuleSource(pass);
    const module = this.device.createShaderModule({ code, label: pass.name });
    let info: GPUCompilationInfo | null = null;
    try {
      info = await module.getCompilationInfo();
    } catch {
      return; // device lost; device.lost handler reports it
    }
    for (const m of info.messages) {
      if (m.type === "error" || m.type === "warning") {
        errors.push({
          message: m.message,
          type: m.type === "error" ? "error" : "warning",
          line: m.lineNum > 0 ? Math.max(1, m.lineNum - preludeLines) : undefined,
          passId: pass.id,
        });
      }
    }
    if (info.messages.some((m) => m.type === "error")) return; // keep prior pipeline

    try {
      if (pass.type === "compute") {
        gp.pipeline = this.device.createComputePipeline({
          layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] }),
          compute: { module, entryPoint: "cs_main" },
        });
        if (isScreen) this.ensureBlit();
      } else {
        gp.pipeline = this.device.createRenderPipeline({
          layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderBGL] }),
          vertex: { module, entryPoint: "vs_main" },
          fragment: {
            module,
            entryPoint: "fs_main",
            targets: [{ format: isScreen ? this.format : BUFFER_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        });
      }
      gp.sig = want;
      gp.type = pass.type;
    } catch (err) {
      errors.push({ message: String(err), type: "error", passId: pass.id });
    }
  }

  private ensureTargets(gp: GPUPass): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (gp.tex && gp.size[0] === w && gp.size[1] === h) return;
    this.destroyTargets(gp);
    const mk = () =>
      this.device.createTexture({
        size: [w, h],
        format: BUFFER_FORMAT,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.STORAGE_BINDING,
      });
    gp.tex = [mk(), mk()];
    gp.size = [w, h];
    gp.read = 0;
  }

  private destroyTargets(gp: GPUPass): void {
    gp.tex?.forEach((t) => t.destroy());
    gp.tex = undefined;
  }

  private ensureBlit(): void {
    if (this.blitPipeline) return;
    const module = this.device.createShaderModule({ code: BLIT_SHADER, label: "blit" });
    this.blitPipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
  }

  private channelInfo(pass: Pass, ch: number): { view: GPUTextureView; res: [number, number] } {
    const c = pass.channels[ch];
    if (c?.source === "pass" && c.passId) {
      const ref = this.passes.get(c.passId);
      if (ref?.tex) return { view: ref.tex[ref.read].createView(), res: [...ref.size] as [number, number] };
    } else if (c?.source === "image" && c.imageId) {
      const img = this.images.get(c.imageId);
      if (img) return { view: img.tex.createView(), res: [img.width, img.height] };
    }
    return { view: this.dummyView, res: [0, 0] };
  }

  private writeUniforms(gp: GPUPass, pass: Pass): void {
    const now = performance.now();
    const effectiveNow = this.paused ? this.pausedAt : now;
    const time = (effectiveNow - this.startTime) / 1000;
    const timeDelta = (effectiveNow - this.lastFrameTime) / 1000;
    const channelRes: [number, number][] = [];
    for (let i = 0; i < NUM_CHANNELS; i++) channelRes.push(this.channelInfo(pass, i).res);
    const data = packUniforms(
      this.layout!,
      {
        resolution: [this.canvas.width, this.canvas.height],
        time,
        timeDelta,
        frame: this.frame,
        mouse: this.mouse,
        channelRes,
      },
      this.customValues,
    );
    this.device.queue.writeBuffer(gp.uniformBuffer, 0, data as BufferSource);
  }

  private makeBindGroup(gp: GPUPass, pass: Pass, computeWriteView?: GPUTextureView): GPUBindGroup {
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: gp.uniformBuffer } },
      { binding: 1, resource: this.sampler },
    ];
    for (let i = 0; i < NUM_CHANNELS; i++) {
      entries.push({ binding: 2 + i, resource: this.channelInfo(pass, i).view });
    }
    if (computeWriteView) entries.push({ binding: 6, resource: computeWriteView });
    return this.device.createBindGroup({
      layout: pass.type === "compute" ? this.computeBGL : this.renderBGL,
      entries,
    });
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const project = this.project;
    if (!project) return;

    // write all uniform buffers first to avoid mid-frame buffer races
    for (let i = 0; i < project.passes.length; i++) {
      const gp = this.passes.get(project.passes[i].id);
      if (gp?.pipeline) this.writeUniforms(gp, project.passes[i]);
    }

    const encoder = this.device.createCommandEncoder();
    const frameStart = performance.now();

    for (let i = 0; i < project.passes.length; i++) {
      const pass = project.passes[i];
      const gp = this.passes.get(pass.id);
      if (!gp?.pipeline) continue;
      const isScreen = i === project.passes.length - 1;
      const write = gp.read ^ 1;

      if (pass.type === "compute") {
        const target = isScreen ? gp.tex?.[write] : gp.tex?.[write];
        // screen compute pass needs an offscreen target to blit from
        const outTex = target ?? this.ensureScreenComputeTarget(gp);
        const bg = this.makeBindGroup(gp, pass, outTex.createView());
        const cpass = encoder.beginComputePass();
        cpass.setPipeline(gp.pipeline as GPUComputePipeline);
        cpass.setBindGroup(0, bg);
        cpass.dispatchWorkgroups(
          Math.ceil(this.canvas.width / 8),
          Math.ceil(this.canvas.height / 8),
        );
        cpass.end();
        if (isScreen) {
          this.ensureBlit();
          const view = this.context.getCurrentTexture().createView();
          const bpass = encoder.beginRenderPass({
            colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
          });
          bpass.setPipeline(this.blitPipeline!);
          bpass.setBindGroup(
            0,
            this.device.createBindGroup({
              layout: this.blitPipeline!.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: outTex.createView() },
                { binding: 1, resource: this.sampler },
              ],
            }),
          );
          bpass.draw(3);
          bpass.end();
        }
      } else {
        const bg = this.makeBindGroup(gp, pass);
        const view = isScreen
          ? this.context.getCurrentTexture().createView()
          : gp.tex![write].createView();
        const rpass = encoder.beginRenderPass({
          colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        });
        rpass.setPipeline(gp.pipeline as GPURenderPipeline);
        rpass.setBindGroup(0, bg);
        rpass.draw(pass.type === "render" ? Math.max(1, pass.vertexCount) : 3);
        rpass.end();
      }
    }

    this.device.queue.submit([encoder.finish()]);
    for (const gp of this.passes.values()) if (gp.tex) gp.read ^= 1;
    if (!this.paused) {
      this.frame++;
      this.lastFrameTime = performance.now();
    }

    const dt = performance.now() - frameStart;
    this.fpsAccum += dt;
    this.fpsCount++;
    if (this.fpsCount >= 30) {
      this.cb.onFps?.(1000 / (this.fpsAccum / this.fpsCount));
      this.fpsAccum = 0;
      this.fpsCount = 0;
    }
  };

  /** A screen-output compute pass has no ping-pong target; give it one to blit from. */
  private screenComputeTex?: GPUTexture;
  private ensureScreenComputeTarget(_gp: GPUPass): GPUTexture {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.screenComputeTex && this.screenComputeTex.width === w && this.screenComputeTex.height === h)
      return this.screenComputeTex;
    this.screenComputeTex?.destroy();
    this.screenComputeTex = this.device.createTexture({
      size: [w, h],
      format: BUFFER_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    return this.screenComputeTex;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const gp of this.passes.values()) {
      this.destroyTargets(gp);
      gp.uniformBuffer.destroy();
    }
    for (const img of this.images.values()) img.tex.destroy();
    this.screenComputeTex?.destroy();
  }
}
