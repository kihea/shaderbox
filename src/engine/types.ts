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

/** Number of input channels (iChannel0..N-1) available to every pass. */
export const NUM_CHANNELS = 4;

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

/** What an iChannel reads from. */
export type ChannelSource = "none" | "pass" | "image";

export interface Channel {
  source: ChannelSource;
  /** Output of another pass, when source === "pass". */
  passId?: string;
  /** An uploaded image, when source === "image". */
  imageId?: string;
}

export function emptyChannels(): Channel[] {
  return Array.from({ length: NUM_CHANNELS }, () => ({ source: "none" }) as Channel);
}

/** An uploaded image, stored inline as a data URL so projects stay portable. */
export interface ImageAsset {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** A single shader pass. The last pass in a project renders to the screen. */
export interface Pass {
  id: string;
  name: string;
  type: ShaderType;
  code: string;
  channels: Channel[];
  /** For `render` passes: vertex count to draw. */
  vertexCount: number;
}

export interface Project {
  id: string;
  name: string;
  backend: ShaderBackend;
  /** Ordered passes; index 0..n-2 are buffers, the last renders to screen. */
  passes: Pass[];
  /** Custom uniforms, shared across all passes. */
  uniforms: CustomUniform[];
  images: ImageAsset[];
  createdAt: number;
  updatedAt: number;
}

export interface ShaderError {
  message: string;
  /** 1-based line within the *user* code, when known. */
  line?: number;
  type: "error" | "warning";
  /** Which pass produced the error, when applicable. */
  passId?: string;
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
  /** Errors are reported per pass; the map key is the pass id. */
  onErrors?: (errors: ShaderError[]) => void;
  onFps?: (fps: number) => void;
}
