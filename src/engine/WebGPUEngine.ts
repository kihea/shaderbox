import type { EngineCallbacks, IEngine, Project, ShaderError } from "./types";
import {
  buildUniformLayout,
  packUniforms,
  type UniformLayout,
} from "./uniforms";

const FRAGMENT_PRELUDE_VS = `struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  // Fullscreen triangle.
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[vi];
  var out: VertexOutput;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = xy * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}
`;

const BLIT_SHADER = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[vi];
  var out: VOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = (xy * 0.5 + 0.5);
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  return textureSampleLevel(src, samp, in.uv, 0.0);
}
`;

export class WebGPUEngine implements IEngine {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private cb: EngineCallbacks;

  private project: Project | null = null;
  private layout: UniformLayout | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private customValues: Record<string, number[]> = {};

  // render / fragment
  private renderPipeline: GPURenderPipeline | null = null;
  private renderBindGroup: GPUBindGroup | null = null;

  // compute
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private storageTex: GPUTexture | null = null;
  private blitPipeline: GPURenderPipeline | null = null;
  private blitBindGroup: GPUBindGroup | null = null;
  private sampler!: GPUSampler;

  private raf = 0;
  private startTime = 0;
  private lastFrameTime = 0;
  private pausedAt = 0;
  private paused = false;
  private frame = 0;
  private mouse: [number, number, number, number] = [0, 0, 0, 0];

  // fps tracking
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
        this.cb.onErrors?.([
          { message: `GPU device lost: ${info.message}`, type: "error" },
        ]);
      }
    });

    const ctx = this.canvas.getContext("webgpu");
    if (!ctx) throw new Error("Could not get a WebGPU canvas context.");
    this.context = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied",
    });
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    this.resize();
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.loop();
  }

  resize(): void {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    // compute storage texture must match canvas size
    if (this.project?.type === "compute") this.rebuild();
  }

  async setProject(project: Project): Promise<void> {
    const layoutChanged =
      !this.project ||
      JSON.stringify(this.project.uniforms.map((u) => [u.name, u.type])) !==
        JSON.stringify(project.uniforms.map((u) => [u.name, u.type]));
    const codeChanged =
      !this.project ||
      this.project.code !== project.code ||
      this.project.type !== project.type ||
      this.project.vertexCount !== project.vertexCount;

    this.project = project;
    this.customValues = {};
    for (const u of project.uniforms) this.customValues[u.name] = u.value;

    if (layoutChanged) this.layout = buildUniformLayout(project.uniforms);
    if (layoutChanged || codeChanged || !this.uniformBuffer) {
      await this.rebuild();
    }
  }

  /** Live-update a custom uniform value without recompiling. */
  setUniformValue(name: string, value: number[]): void {
    this.customValues[name] = value;
  }

  setPaused(p: boolean): void {
    if (p === this.paused) return;
    const now = performance.now();
    if (p) {
      this.pausedAt = now;
    } else {
      // shift the clock forward so time doesn't jump
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
      const x = (e.clientX - r.left) * this.dpr;
      const y = (e.clientY - r.top) * this.dpr;
      this.mouse[0] = x;
      this.mouse[1] = this.canvas.height - y;
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      const r = rect();
      this.mouse[2] = (e.clientX - r.left) * this.dpr;
      this.mouse[3] = this.canvas.height - (e.clientY - r.top) * this.dpr;
    });
  }

  private async compileModule(
    code: string,
    label: string,
  ): Promise<{ module: GPUShaderModule; errors: ShaderError[]; preludeLines: number }> {
    const module = this.device.createShaderModule({ code, label });
    // count prelude lines to translate WGSL line numbers back to user code
    const preludeLines = this.currentPreludeLineCount;
    let info: GPUCompilationInfo;
    try {
      info = await module.getCompilationInfo();
    } catch {
      // device/instance lost during compilation — the device.lost handler
      // reports the real cause; don't surface the low-level wire error here.
      return { module, errors: [], preludeLines };
    }
    const errors: ShaderError[] = info.messages
      .filter((m) => m.type === "error" || m.type === "warning")
      .map((m) => ({
        message: m.message,
        type: m.type === "error" ? "error" : "warning",
        line: m.lineNum > 0 ? Math.max(1, m.lineNum - preludeLines) : undefined,
      }));
    return { module, errors, preludeLines };
  }

  private currentPreludeLineCount = 0;

  private buildModuleSource(): { code: string; preludeLines: number } {
    const p = this.project!;
    const struct = this.layout!.wgslStruct;
    let prelude = `${struct}\n@group(0) @binding(0) var<uniform> u: Uniforms;\n`;
    if (p.type === "fragment") {
      prelude += FRAGMENT_PRELUDE_VS + "\n";
    } else if (p.type === "compute") {
      prelude +=
        "@group(0) @binding(1) var outImage: texture_storage_2d<rgba8unorm, write>;\n";
    }
    const preludeLines = prelude.split("\n").length - 1;
    return { code: prelude + p.code, preludeLines };
  }

  private async rebuild(): Promise<void> {
    if (this.disposed || !this.project || !this.layout) return;
    const p = this.project;

    // (Re)create uniform buffer if size changed.
    if (!this.uniformBuffer || this.uniformBuffer.size !== this.layout.byteSize) {
      this.uniformBuffer?.destroy();
      this.uniformBuffer = this.device.createBuffer({
        size: this.layout.byteSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    this.device.pushErrorScope("validation");
    const { code, preludeLines } = this.buildModuleSource();
    this.currentPreludeLineCount = preludeLines;

    try {
      const { module, errors } = await this.compileModule(code, `${p.type}-user`);
      this.cb.onErrors?.(errors);
      if (errors.some((e) => e.type === "error")) {
        await this.device.popErrorScope();
        return;
      }

      // reset pipelines
      this.renderPipeline = null;
      this.computePipeline = null;

      if (p.type === "fragment" || p.type === "render") {
        this.renderPipeline = this.device.createRenderPipeline({
          layout: "auto",
          vertex: { module, entryPoint: "vs_main" },
          fragment: {
            module,
            entryPoint: "fs_main",
            targets: [{ format: this.format }],
          },
          primitive: { topology: "triangle-list" },
        });
        this.renderBindGroup = this.device.createBindGroup({
          layout: this.renderPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
        });
      } else if (p.type === "compute") {
        this.computePipeline = this.device.createComputePipeline({
          layout: "auto",
          compute: { module, entryPoint: "cs_main" },
        });
        this.ensureStorageTexture();
        this.computeBindGroup = this.device.createBindGroup({
          layout: this.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: this.storageTex!.createView() },
          ],
        });
        this.ensureBlitPipeline();
      }
    } catch (err) {
      this.cb.onErrors?.([{ message: String(err), type: "error" }]);
    }

    try {
      const scoped = await this.device.popErrorScope();
      if (scoped && !this.disposed) {
        this.cb.onErrors?.([{ message: scoped.message, type: "error" }]);
      }
    } catch {
      // device/instance may have been dropped during teardown — ignore
    }
  }

  private ensureStorageTexture(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.storageTex && this.storageTex.width === w && this.storageTex.height === h)
      return;
    this.storageTex?.destroy();
    this.storageTex = this.device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
    });
  }

  private ensureBlitPipeline(): void {
    if (!this.blitPipeline) {
      const module = this.device.createShaderModule({ code: BLIT_SHADER, label: "blit" });
      this.blitPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: this.format }] },
        primitive: { topology: "triangle-list" },
      });
    }
    this.blitBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.storageTex!.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
  }

  private writeUniforms(): void {
    if (!this.layout || !this.uniformBuffer || !this.project) return;
    const now = performance.now();
    const effectiveNow = this.paused ? this.pausedAt : now;
    const time = (effectiveNow - this.startTime) / 1000;
    const timeDelta = (effectiveNow - this.lastFrameTime) / 1000;
    if (!this.paused) this.lastFrameTime = effectiveNow;

    const data = packUniforms(
      this.layout,
      {
        resolution: [this.canvas.width, this.canvas.height],
        time,
        timeDelta,
        frame: this.frame,
        mouse: this.mouse,
      },
      this.customValues,
    );
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data as BufferSource);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.project) return;

    const frameStart = performance.now();
    this.writeUniforms();

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const p = this.project;

    if ((p.type === "fragment" || p.type === "render") && this.renderPipeline) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      pass.setPipeline(this.renderPipeline);
      pass.setBindGroup(0, this.renderBindGroup!);
      const count = p.type === "fragment" ? 3 : Math.max(1, p.vertexCount);
      pass.draw(count);
      pass.end();
    } else if (p.type === "compute" && this.computePipeline) {
      const cpass = encoder.beginComputePass();
      cpass.setPipeline(this.computePipeline);
      cpass.setBindGroup(0, this.computeBindGroup!);
      cpass.dispatchWorkgroups(
        Math.ceil(this.canvas.width / 8),
        Math.ceil(this.canvas.height / 8),
      );
      cpass.end();

      const bpass = encoder.beginRenderPass({
        colorAttachments: [
          { view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      bpass.setPipeline(this.blitPipeline!);
      bpass.setBindGroup(0, this.blitBindGroup!);
      bpass.draw(3);
      bpass.end();
    } else {
      return;
    }

    this.device.queue.submit([encoder.finish()]);
    if (!this.paused) this.frame++;

    // fps
    const dt = performance.now() - frameStart;
    this.fpsAccum += dt;
    this.fpsCount++;
    if (this.fpsCount >= 30) {
      this.cb.onFps?.(1000 / (this.fpsAccum / this.fpsCount));
      this.fpsAccum = 0;
      this.fpsCount = 0;
    }
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.uniformBuffer?.destroy();
    this.storageTex?.destroy();
  }
}
