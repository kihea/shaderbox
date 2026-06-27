export type ShaderType = "fragment" | "compute" | "render";

/** Which graphics API / shading language a sandbox targets. */
export type ShaderBackend = "webgpu" | "webgl2";

/** Shader types each backend can run. */
export const BACKEND_TYPES: Record<ShaderBackend, ShaderType[]> = {
  webgpu: ["fragment", "compute", "render"],
  webgl2: ["fragment", "render"],
};

export const BACKEND_LABEL: Record<ShaderBackend, string> = {
  webgpu: "WebGPU · WGSL",
  webgl2: "WebGL2 · GLSL",
};

/** Types a user-defined ("custom outside variable") uniform can take. */
export type UniformType = "float" | "vec2" | "vec3" | "vec4" | "color";

export interface CustomUniform {
  /** Identifier used in WGSL as `u.<name>`. Must be a valid WGSL identifier. */
  name: string;
  type: UniformType;
  /** Current value, length matches the component count of `type`. */
  value: number[];
  /** Slider bounds (ignored for `color`). */
  min: number;
  max: number;
  step: number;
}

export interface Project {
  id: string;
  name: string;
  backend: ShaderBackend;
  type: ShaderType;
  code: string;
  uniforms: CustomUniform[];
  /** For `render` mode: how many vertices to draw. */
  vertexCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ShaderError {
  message: string;
  /** 1-based line within the *user* code, when known. */
  line?: number;
  type: "error" | "warning";
}

/** Common surface implemented by both the WebGPU and WebGL2 engines. */
export interface IEngine {
  init(): Promise<void>;
  resize(): void;
  setProject(project: Project): void | Promise<void>;
  setUniformValue(name: string, value: number[]): void;
  setPaused(paused: boolean): void;
  resetTime(): void;
  dispose(): void;
}

export interface EngineCallbacks {
  onErrors?: (errors: ShaderError[]) => void;
  onFps?: (fps: number) => void;
}
