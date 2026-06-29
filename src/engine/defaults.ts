import {
  emptyChannels,
  type Pass,
  type Project,
  type ShaderBackend,
  type ShaderType,
} from "./types";

/**
 * WGSL (WebGPU) prelude exposes, for every pass:
 *   struct Uniforms { resolution, time, timeDelta, frame, mouse,
 *                     channelRes0..3, ...customs };
 *   @group(0) @binding(0) var<uniform> u: Uniforms;
 *   @group(0) @binding(1) var iSampler: sampler;
 *   @group(0) @binding(2..5) var iChannel0..3: texture_2d<f32>;
 *   // compute passes also get binding(6) outImage: storage texture
 *
 * GLSL (WebGL2) prelude exposes plain globals: resolution, time, timeDelta,
 * frame, mouse, iChannelResolution[4], custom uniforms, and
 * uniform sampler2D iChannel0..3.
 */

// ---------------------------------------------------------------- WGSL
const WGSL_FRAGMENT = `// Fragment pass — write fs_main. Sample inputs with
// textureSample(iChannel0, iSampler, in.uv). Built-ins: u.time, u.resolution,
// u.mouse (xy cursor px, zw last click), u.channelRes0..3.
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

const WGSL_COMPUTE = `// Compute pass — write to outImage with textureStore. Its output texture
// can be bound as an iChannel of a later pass. Read inputs with
// textureLoad(iChannel0, vec2i(gid.xy), 0).
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

const WGSL_RENDER = `// Render pass — write vs_main + fs_main. Draws \`vertexCount\` vertices.
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
const GLSL_FRAGMENT = `// Fragment pass (GLSL ES 3.00) — write main(), assign fragColor.
// Sample inputs with texture(iChannel0, uv). Built-ins: time, resolution,
// mouse (xy cursor, zw last click), iChannelResolution[4], uv in [0,1].
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

const GLSL_RENDER = `// Render pass (GLSL) — vertex stage below, fragment after the marker.
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
  if (type === "render") return GLSL_RENDER;
  return GLSL_FRAGMENT;
}

let counter = 0;
function uid(tag: string): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}-${tag}`;
}

export function newPass(
  backend: ShaderBackend,
  type: ShaderType,
  name: string,
): Pass {
  return {
    id: uid("pass"),
    name,
    type,
    code: defaultCode(backend, type),
    channels: emptyChannels(),
    vertexCount: 3,
  };
}

export function newProject(
  backend: ShaderBackend = "webgpu",
  type: ShaderType = "fragment",
): Project {
  const now = Date.now();
  return {
    id: uid("proj"),
    name: "Untitled",
    backend,
    passes: [newPass(backend, type, "Image")],
    uniforms: [],
    images: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Letter label for buffer passes: A, B, C… */
export function bufferLabel(index: number): string {
  return String.fromCharCode(65 + index);
}
