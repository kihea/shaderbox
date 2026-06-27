import type { Project, ShaderBackend, ShaderType } from "./types";

/**
 * WGSL (WebGPU) injects a hidden prelude before the user's code:
 *
 *   struct Uniforms { resolution, time, timeDelta, frame, mouse, ...customs };
 *   @group(0) @binding(0) var<uniform> u: Uniforms;
 *
 * fragment: prelude also defines `VertexOutput` + `vs_main` (fullscreen
 *           triangle). You write `fs_main(in: VertexOutput) -> @location(0) vec4f`.
 * compute:  prelude also defines binding(1) `outImage`
 *           (texture_storage_2d<rgba8unorm, write>). You write `cs_main`.
 * render:   prelude defines only uniforms. You write `vs_main` + `fs_main`.
 *
 * GLSL (WebGL2) injects `#version 300 es`, a `precision` line, and the same set
 * of uniforms as plain globals: `resolution`, `time`, `timeDelta`, `frame`,
 * `mouse`, plus any customs. No compute (the stage does not exist in WebGL2).
 */

// ---------------------------------------------------------------- WGSL
const WGSL_FRAGMENT = `// Fragment mode — write fs_main. Available: u.time, u.resolution,
// u.mouse (xy = cursor px, zw = last click px), in.uv in [0,1], in.pos.
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.uv;
  let p = uv * 6.0;
  let t = u.time;
  var v = sin(p.x + t);
  v += sin(p.y + t * 1.3);
  v += sin((p.x + p.y) * 0.5 + t * 0.7);
  v += sin(length(p - 3.0) - t * 2.0);
  v = v * 0.25 + 0.5;
  let col = vec3f(
    0.5 + 0.5 * cos(6.28318 * (v + 0.0)),
    0.5 + 0.5 * cos(6.28318 * (v + 0.33)),
    0.5 + 0.5 * cos(6.28318 * (v + 0.67)),
  );
  return vec4f(col, 1.0);
}
`;

const WGSL_COMPUTE = `// Compute mode — write to outImage with textureStore.
// Dispatched over the canvas in 8x8 workgroups; the result is blitted to screen.
@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2f(u.resolution);
  let px = vec2f(f32(gid.x), f32(gid.y));
  if (px.x >= dims.x || px.y >= dims.y) { return; }
  let uv = px / dims;
  let c = 0.5 + 0.5 * cos(u.time + uv.xyx * 4.0 + vec3f(0.0, 2.0, 4.0));
  textureStore(outImage, vec2i(i32(gid.x), i32(gid.y)), vec4f(c, 1.0));
}
`;

const WGSL_RENDER = `// Render mode — write vs_main + fs_main. Draws \`vertexCount\` vertices.
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  let a = f32(vi) / 3.0 * 6.28318 + u.time;
  let p = vec2f(cos(a), sin(a)) * 0.6;
  var out: VSOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.color = 0.5 + 0.5 * cos(vec3f(a) + vec3f(0.0, 2.0, 4.0));
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}
`;

// ---------------------------------------------------------------- GLSL
const GLSL_FRAGMENT = `// Fragment mode (GLSL ES 3.00) — write main(), assign to fragColor.
// Available: time, resolution, mouse (xy cursor px, zw last click px), uv in [0,1].
void main() {
  vec2 p = uv * 6.0;
  float t = time;
  float v = sin(p.x + t);
  v += sin(p.y + t * 1.3);
  v += sin((p.x + p.y) * 0.5 + t * 0.7);
  v += sin(length(p - 3.0) - t * 2.0);
  v = v * 0.25 + 0.5;
  vec3 col = 0.5 + 0.5 * cos(6.28318 * (v + vec3(0.0, 0.33, 0.67)));
  fragColor = vec4(col, 1.0);
}
`;

/**
 * GLSL render mode keeps both stages in one editor, separated by a line that
 * starts with `//--- fragment`. Text above it is the vertex shader body, below
 * is the fragment shader. Both share the uniform prelude.
 */
const GLSL_RENDER = `// Render mode (GLSL) — vertex stage below, fragment stage after the marker.
// Draws \`vertexCount\` vertices using gl_VertexID (no vertex buffers needed).
out vec3 vColor;
void main() {
  float a = float(gl_VertexID) / 3.0 * 6.2831853 + time;
  vec2 p = vec2(cos(a), sin(a)) * 0.6;
  vColor = 0.5 + 0.5 * cos(vec3(a) + vec3(0.0, 2.0, 4.0));
  gl_Position = vec4(p, 0.0, 1.0);
}

//--- fragment ---
in vec3 vColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}
`;

export function defaultCode(backend: ShaderBackend, type: ShaderType): string {
  if (backend === "webgpu") {
    if (type === "compute") return WGSL_COMPUTE;
    if (type === "render") return WGSL_RENDER;
    return WGSL_FRAGMENT;
  }
  // webgl2
  if (type === "render") return GLSL_RENDER;
  return GLSL_FRAGMENT;
}

let counter = 0;
export function newProject(
  backend: ShaderBackend = "webgpu",
  type: ShaderType = "fragment",
): Project {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${(counter++).toString(36)}`,
    name: "Untitled",
    backend,
    type,
    code: defaultCode(backend, type),
    uniforms: [],
    vertexCount: 3,
    createdAt: now,
    updatedAt: now,
  };
}
