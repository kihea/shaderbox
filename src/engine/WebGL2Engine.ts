import type {
  EngineCallbacks,
  IEngine,
  ImageAsset,
  Pass,
  Project,
  ShaderError,
} from "./types";
import { NUM_CHANNELS } from "./types";

const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 pos = vec2(float((gl_VertexID & 1) << 2) - 1.0,
                  float((gl_VertexID & 2) << 1) - 1.0);
  uv = pos * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const FRAGMENT_RE = /^\s*\/\/\s*-+\s*fragment/i;
const GLSL_TYPE: Record<string, string> = {
  float: "float",
  vec2: "vec2",
  vec3: "vec3",
  vec4: "vec4",
  color: "vec3",
};

const BUILTIN_NAMES = ["resolution", "time", "timeDelta", "frame", "mouse"];

interface GLPass {
  passId: string;
  program: WebGLProgram | null;
  locs: Record<string, WebGLUniformLocation | null>;
  /** Signature of the last successful compile, to skip redundant rebuilds. */
  sig: string;
  /** Ping-pong render targets for buffer passes (undefined for the screen pass). */
  tex?: [WebGLTexture, WebGLTexture];
  fbo?: [WebGLFramebuffer, WebGLFramebuffer];
  read: number; // index into tex/fbo to read from this frame
  size: [number, number];
}

interface GLImage {
  tex: WebGLTexture;
  width: number;
  height: number;
  src: string; // dataUrl this texture was built from
}

export class WebGL2Engine implements IEngine {
  private canvas: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private cb: EngineCallbacks;

  private project: Project | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private dummyTex!: WebGLTexture;
  private passes: Map<string, GLPass> = new Map();
  private images: Map<string, GLImage> = new Map();
  private customValues: Record<string, number[]> = {};
  private customSig = "";

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
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.dummyTex = this.makeTexture(1, 1, new Uint8Array([0, 0, 0, 255]));
    this.resize();
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.loop();
  }

  resize(): void {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  setProject(project: Project): void {
    this.project = project;
    this.customValues = {};
    for (const u of project.uniforms) this.customValues[u.name] = u.value;
    this.customSig = project.uniforms.map((u) => `${u.name}:${u.type}`).join(",");

    this.syncImages(project.images);

    const errors: ShaderError[] = [];
    const liveIds = new Set(project.passes.map((p) => p.id));
    // drop GL passes that no longer exist
    for (const [id, gp] of this.passes) {
      if (!liveIds.has(id)) {
        this.destroyPass(gp);
        this.passes.delete(id);
      }
    }
    for (let i = 0; i < project.passes.length; i++) {
      const pass = project.passes[i];
      const isScreen = i === project.passes.length - 1;
      this.ensurePass(pass, isScreen, errors);
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

  // ----------------------------------------------------------------- textures
  private makeTexture(w: number, h: number, data: Uint8Array | null): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  private syncImages(assets: ImageAsset[]): void {
    const gl = this.gl;
    const live = new Set(assets.map((a) => a.id));
    for (const [id, img] of this.images) {
      if (!live.has(id)) {
        gl.deleteTexture(img.tex);
        this.images.delete(id);
      }
    }
    for (const a of assets) {
      const existing = this.images.get(a.id);
      if (existing && existing.src === a.dataUrl) continue;
      const rec: GLImage = existing ?? {
        tex: this.makeTexture(1, 1, new Uint8Array([0, 0, 0, 255])),
        width: 1,
        height: 1,
        src: "",
      };
      rec.src = a.dataUrl;
      this.images.set(a.id, rec);
      const el = new Image();
      el.onload = () => {
        if (this.disposed) return;
        gl.bindTexture(gl.TEXTURE_2D, rec.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.bindTexture(gl.TEXTURE_2D, null);
        rec.width = el.naturalWidth;
        rec.height = el.naturalHeight;
      };
      el.src = a.dataUrl;
    }
  }

  // ----------------------------------------------------------------- passes
  private uniformDecls(): string {
    const builtins = [
      "uniform vec2 resolution;",
      "uniform float time;",
      "uniform float timeDelta;",
      "uniform float frame;",
      "uniform vec4 mouse;",
      `uniform vec2 iChannelResolution[${NUM_CHANNELS}];`,
    ];
    for (let i = 0; i < NUM_CHANNELS; i++) builtins.push(`uniform sampler2D iChannel${i};`);
    const customs = (this.project?.uniforms ?? []).map(
      (c) => `uniform ${GLSL_TYPE[c.type]} ${c.name};`,
    );
    return [...builtins, ...customs].join("\n");
  }

  private buildSources(pass: Pass): {
    vs: string;
    fs: string;
    vsPrelude: number;
    fsPrelude: number;
    markerLine: number;
  } {
    const decls = this.uniformDecls();
    if (pass.type !== "render") {
      const fsPreludeText = `#version 300 es\nprecision highp float;\n${decls}\nin vec2 uv;\nout vec4 fragColor;\n`;
      return {
        vs: FULLSCREEN_VS,
        fs: fsPreludeText + pass.code,
        vsPrelude: FULLSCREEN_VS.split("\n").length - 1,
        fsPrelude: fsPreludeText.split("\n").length - 1,
        markerLine: 0,
      };
    }
    const lines = pass.code.split("\n");
    let idx = lines.findIndex((l) => FRAGMENT_RE.test(l));
    if (idx < 0) idx = lines.length;
    const vsBody = lines.slice(0, idx).join("\n");
    const fsBody = lines.slice(idx + 1).join("\n");
    const vsPreludeText = `#version 300 es\nprecision highp float;\n${decls}\n`;
    const fsPreludeText = `#version 300 es\nprecision highp float;\n${decls}\nout vec4 fragColor;\n`;
    return {
      vs: vsPreludeText + vsBody,
      fs: fsPreludeText + fsBody,
      vsPrelude: vsPreludeText.split("\n").length - 1,
      fsPrelude: fsPreludeText.split("\n").length - 1,
      markerLine: idx + 1,
    };
  }

  private compileShader(type: number, src: string): { shader: WebGLShader | null; log: string } {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "compile failed";
      gl.deleteShader(shader);
      return { shader: null, log };
    }
    return { shader, log: "" };
  }

  private parseLog(
    log: string,
    preludeLines: number,
    editorOffset: number,
    passId: string,
  ): ShaderError[] {
    const out: ShaderError[] = [];
    for (const raw of log.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/i);
      if (m) {
        const userLine = parseInt(m[2], 10) - preludeLines;
        out.push({
          message: m[3] || line,
          type: m[1].toUpperCase() === "WARNING" ? "warning" : "error",
          line: userLine > 0 ? userLine + editorOffset : undefined,
          passId,
        });
      } else {
        out.push({ message: line, type: "error", passId });
      }
    }
    return out;
  }

  private ensurePass(pass: Pass, isScreen: boolean, errors: ShaderError[]): void {
    const gl = this.gl;
    let gp = this.passes.get(pass.id);
    if (!gp) {
      gp = {
        passId: pass.id,
        program: null,
        locs: {},
        sig: "",
        read: 0,
        size: [0, 0],
      };
      this.passes.set(pass.id, gp);
    }

    // buffer passes need ping-pong targets; the screen pass renders to canvas
    if (!isScreen) this.ensureTargets(gp);
    else this.destroyTargets(gp);

    // recompile only when the shader source, type, or uniform decls change
    const want = `${pass.type}::${this.customSig}::${pass.code}`;
    if (gp.program && gp.sig === want) return;

    const { vs, fs, vsPrelude, fsPrelude, markerLine } = this.buildSources(pass);
    const v = this.compileShader(gl.VERTEX_SHADER, vs);
    if (!v.shader) errors.push(...this.parseLog(v.log, vsPrelude, 0, pass.id));
    const f = this.compileShader(gl.FRAGMENT_SHADER, fs);
    if (!f.shader) {
      errors.push(...this.parseLog(f.log, fsPrelude, markerLine > 0 ? markerLine : 0, pass.id));
    }
    if (!v.shader || !f.shader) {
      v.shader && gl.deleteShader(v.shader);
      f.shader && gl.deleteShader(f.shader);
      return; // keep previous working program
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, v.shader);
    gl.attachShader(program, f.shader);
    gl.linkProgram(program);
    gl.deleteShader(v.shader);
    gl.deleteShader(f.shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      errors.push({ message: gl.getProgramInfoLog(program) ?? "link failed", type: "error", passId: pass.id });
      gl.deleteProgram(program);
      return;
    }

    if (gp.program) gl.deleteProgram(gp.program);
    gp.program = program;
    gp.sig = want;
    gp.locs = {};
    const names = [
      ...BUILTIN_NAMES,
      "iChannelResolution",
      ...Array.from({ length: NUM_CHANNELS }, (_, i) => `iChannel${i}`),
      ...(this.project?.uniforms ?? []).map((c) => c.name),
    ];
    for (const n of names) gp.locs[n] = gl.getUniformLocation(program, n);
  }

  private ensureTargets(gp: GLPass): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (gp.tex && gp.size[0] === w && gp.size[1] === h) return;
    this.destroyTargets(gp);
    const mk = (): [WebGLTexture, WebGLFramebuffer] => {
      const tex = this.makeTexture(w, h, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return [tex, fbo];
    };
    const a = mk();
    const b = mk();
    gp.tex = [a[0], b[0]];
    gp.fbo = [a[1], b[1]];
    gp.size = [w, h];
    gp.read = 0;
  }

  private destroyTargets(gp: GLPass): void {
    const gl = this.gl;
    if (gp.tex) gp.tex.forEach((t) => gl.deleteTexture(t));
    if (gp.fbo) gp.fbo.forEach((f) => gl.deleteFramebuffer(f));
    gp.tex = undefined;
    gp.fbo = undefined;
  }

  private destroyPass(gp: GLPass): void {
    if (gp.program) this.gl.deleteProgram(gp.program);
    this.destroyTargets(gp);
  }

  /** Texture + resolution to bind for one channel of the active pass. */
  private channelTexture(pass: Pass, ch: number): { tex: WebGLTexture; res: [number, number] } {
    const c = pass.channels[ch];
    if (c?.source === "pass" && c.passId) {
      const gp = this.passes.get(c.passId);
      if (gp?.tex) return { tex: gp.tex[gp.read], res: [...gp.size] as [number, number] };
    } else if (c?.source === "image" && c.imageId) {
      const img = this.images.get(c.imageId);
      if (img) return { tex: img.tex, res: [img.width, img.height] };
    }
    return { tex: this.dummyTex, res: [0, 0] };
  }

  private setUniforms(gp: GLPass, pass: Pass): void {
    const gl = this.gl;
    const now = performance.now();
    const effectiveNow = this.paused ? this.pausedAt : now;
    const time = (effectiveNow - this.startTime) / 1000;
    const timeDelta = (effectiveNow - this.lastFrameTime) / 1000;

    const set = (name: string, fn: (l: WebGLUniformLocation) => void) => {
      const l = gp.locs[name];
      if (l) fn(l);
    };
    set("resolution", (l) => gl.uniform2f(l, this.canvas.width, this.canvas.height));
    set("time", (l) => gl.uniform1f(l, time));
    set("timeDelta", (l) => gl.uniform1f(l, timeDelta));
    set("frame", (l) => gl.uniform1f(l, this.frame));
    set("mouse", (l) => gl.uniform4f(l, ...this.mouse));

    // bind channel textures to units 0..N-1
    const res = new Float32Array(NUM_CHANNELS * 2);
    for (let i = 0; i < NUM_CHANNELS; i++) {
      const { tex, res: r } = this.channelTexture(pass, i);
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      set(`iChannel${i}`, (l) => gl.uniform1i(l, i));
      res[i * 2] = r[0];
      res[i * 2 + 1] = r[1];
    }
    set("iChannelResolution", (l) => gl.uniform2fv(l, res));

    for (const c of this.project!.uniforms) {
      const val = this.customValues[c.name] ?? [];
      set(c.name, (l) => {
        switch (c.type) {
          case "float":
            gl.uniform1f(l, val[0] ?? 0);
            break;
          case "vec2":
            gl.uniform2f(l, val[0] ?? 0, val[1] ?? 0);
            break;
          case "vec3":
          case "color":
            gl.uniform3f(l, val[0] ?? 0, val[1] ?? 0, val[2] ?? 0);
            break;
          case "vec4":
            gl.uniform4f(l, val[0] ?? 0, val[1] ?? 0, val[2] ?? 0, val[3] ?? 0);
            break;
        }
      });
    }
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const project = this.project;
    if (!project) return;
    const gl = this.gl;
    const frameStart = performance.now();

    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.bindVertexArray(this.vao);

    for (let i = 0; i < project.passes.length; i++) {
      const pass = project.passes[i];
      const gp = this.passes.get(pass.id);
      if (!gp?.program) continue;
      const isScreen = i === project.passes.length - 1;

      if (!isScreen && gp.fbo) {
        const write = gp.read ^ 1;
        gl.bindFramebuffer(gl.FRAMEBUFFER, gp.fbo[write]);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(gp.program);
      this.setUniforms(gp, pass);
      const count = pass.type === "render" ? Math.max(1, pass.vertexCount) : 3;
      gl.drawArrays(gl.TRIANGLES, 0, count);
    }

    // swap ping-pong buffers after all passes have read this frame's fronts
    for (const gp of this.passes.values()) if (gp.tex) gp.read ^= 1;

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const gp of this.passes.values()) this.destroyPass(gp);
    for (const img of this.images.values()) this.gl?.deleteTexture(img.tex);
    if (this.vao) this.gl?.deleteVertexArray(this.vao);
  }
}
