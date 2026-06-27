import type { EngineCallbacks, IEngine, Project, ShaderError } from "./types";
import { TYPE_INFO } from "./uniforms";

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

/** GLSL types for the built-in + custom uniforms, mirroring the WGSL struct. */
const GLSL_TYPE: Record<string, string> = {
  float: "float",
  vec2: "vec2",
  vec3: "vec3",
  vec4: "vec4",
  color: "vec3",
};

interface UniformInfo {
  name: string;
  type: keyof typeof TYPE_INFO;
}

export class WebGL2Engine implements IEngine {
  private canvas: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private cb: EngineCallbacks;

  private project: Project | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private customValues: Record<string, number[]> = {};
  private customInfos: UniformInfo[] = [];
  private locs: Record<string, WebGLUniformLocation | null> = {};

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
      const c = document.createElement("canvas");
      return !!c.getContext("webgl2");
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.vao = gl.createVertexArray();
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
    const codeChanged =
      !this.project ||
      this.project.code !== project.code ||
      this.project.type !== project.type;
    const uniformsChanged =
      !this.project ||
      JSON.stringify(this.project.uniforms.map((u) => [u.name, u.type])) !==
        JSON.stringify(project.uniforms.map((u) => [u.name, u.type]));

    this.project = project;
    this.customValues = {};
    this.customInfos = project.uniforms.map((u) => ({ name: u.name, type: u.type }));
    for (const u of project.uniforms) this.customValues[u.name] = u.value;

    if (codeChanged || uniformsChanged || !this.program) this.rebuild();
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

  private uniformDecls(): string {
    const builtins = [
      "uniform vec2 resolution;",
      "uniform float time;",
      "uniform float timeDelta;",
      "uniform float frame;",
      "uniform vec4 mouse;",
    ];
    const customs = this.customInfos.map(
      (c) => `uniform ${GLSL_TYPE[c.type]} ${c.name};`,
    );
    return [...builtins, ...customs].join("\n");
  }

  private buildSources(): {
    vs: string;
    fs: string;
    vsPrelude: number;
    fsPrelude: number;
    markerLine: number; // editor line of the //--- fragment marker (0 if none)
  } {
    const p = this.project!;
    const decls = this.uniformDecls();
    if (p.type === "fragment") {
      const fsPreludeText = `#version 300 es\nprecision highp float;\n${decls}\nin vec2 uv;\nout vec4 fragColor;\n`;
      return {
        vs: FULLSCREEN_VS,
        fs: fsPreludeText + p.code,
        vsPrelude: FULLSCREEN_VS.split("\n").length - 1,
        fsPrelude: fsPreludeText.split("\n").length - 1,
        markerLine: 0,
      };
    }
    // render: split on the //--- fragment marker
    const lines = p.code.split("\n");
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

  private compile(type: number, src: string): { shader: WebGLShader | null; log: string } {
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

  /** Parse `ERROR: 0:LINE: msg` lines into ShaderErrors, mapping to editor lines. */
  private parseLog(
    log: string,
    glslPreludeLines: number,
    editorOffset: number,
  ): ShaderError[] {
    const out: ShaderError[] = [];
    for (const raw of log.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/i);
      if (m) {
        const glslLine = parseInt(m[2], 10);
        const userLine = glslLine - glslPreludeLines;
        out.push({
          message: m[3] || line,
          type: m[1].toUpperCase() === "WARNING" ? "warning" : "error",
          line: userLine > 0 ? userLine + editorOffset : undefined,
        });
      } else {
        out.push({ message: line, type: "error" });
      }
    }
    return out;
  }

  private rebuild(): void {
    if (!this.project) return;
    const gl = this.gl;
    const { vs, fs, vsPrelude, fsPrelude, markerLine } = this.buildSources();

    const errors: ShaderError[] = [];
    const v = this.compile(gl.VERTEX_SHADER, vs);
    if (!v.shader) errors.push(...this.parseLog(v.log, vsPrelude, 0));
    const f = this.compile(gl.FRAGMENT_SHADER, fs);
    if (!f.shader) {
      const offset = markerLine > 0 ? markerLine : 0;
      errors.push(...this.parseLog(f.log, fsPrelude, offset));
    }

    if (!v.shader || !f.shader) {
      v.shader && gl.deleteShader(v.shader);
      f.shader && gl.deleteShader(f.shader);
      this.cb.onErrors?.(errors);
      return;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, v.shader);
    gl.attachShader(program, f.shader);
    gl.linkProgram(program);
    gl.deleteShader(v.shader);
    gl.deleteShader(f.shader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      errors.push({ message: gl.getProgramInfoLog(program) ?? "link failed", type: "error" });
      gl.deleteProgram(program);
      this.cb.onErrors?.(errors);
      return;
    }

    if (this.program) gl.deleteProgram(this.program);
    this.program = program;

    // cache uniform locations
    this.locs = {};
    const names = ["resolution", "time", "timeDelta", "frame", "mouse"].concat(
      this.customInfos.map((c) => c.name),
    );
    for (const n of names) this.locs[n] = gl.getUniformLocation(program, n);

    this.cb.onErrors?.(errors); // may carry warnings
  }

  private setUniforms(): void {
    const gl = this.gl;
    const now = performance.now();
    const effectiveNow = this.paused ? this.pausedAt : now;
    const time = (effectiveNow - this.startTime) / 1000;
    const timeDelta = (effectiveNow - this.lastFrameTime) / 1000;
    if (!this.paused) this.lastFrameTime = effectiveNow;

    const set = (name: string, fn: (l: WebGLUniformLocation) => void) => {
      const l = this.locs[name];
      if (l) fn(l);
    };
    set("resolution", (l) => gl.uniform2f(l, this.canvas.width, this.canvas.height));
    set("time", (l) => gl.uniform1f(l, time));
    set("timeDelta", (l) => gl.uniform1f(l, timeDelta));
    set("frame", (l) => gl.uniform1f(l, this.frame));
    set("mouse", (l) => gl.uniform4f(l, ...this.mouse));

    for (const c of this.customInfos) {
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
    if (!this.project || !this.program) return;
    const gl = this.gl;
    const frameStart = performance.now();

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    this.setUniforms();

    const count =
      this.project.type === "fragment" ? 3 : Math.max(1, this.project.vertexCount);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);

    if (!this.paused) this.frame++;

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
    if (this.program) this.gl?.deleteProgram(this.program);
    if (this.vao) this.gl?.deleteVertexArray(this.vao);
  }
}
