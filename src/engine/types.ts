export type ShaderType = "fragment" | "compute" | "render";

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
