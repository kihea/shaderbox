import type { Project, ShaderType } from "./types";

/**
 * Each mode injects a hidden prelude before the user's code:
 *
 *   struct Uniforms { resolution, time, timeDelta, frame, mouse, ...customs };
 *   @group(0) @binding(0) var<uniform> u: Uniforms;
 *
 * fragment: prelude also defines `VertexOutput` and `vs_main` (fullscreen
 *           triangle). You write `fs_main(in: VertexOutput) -> @location(0) vec4f`.
 * compute:  prelude also defines `@group(0) @binding(1) var outImage:
 *           texture_storage_2d<rgba8unorm, write>`. You write `cs_main`.
 * render:   prelude defines only the uniforms. You write both `vs_main` and
 *           `fs_main` and draw `vertexCount` vertices.
 */

const FRAGMENT_DEFAULT = `// Fragment mode — write fs_main. Available: u.time, u.resolution,
// u.mouse (xy = cursor px, zw = last click px), in.uv in [0,1], in.pos.
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.uv;
  // animated plasma
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

const COMPUTE_DEFAULT = `// Compute mode — write to outImage with textureStore.
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

const RENDER_DEFAULT = `// Render mode — write vs_main + fs_main. Draws \`vertexCount\` vertices.
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  let a = f32(vi) / 3.0 * 6.28318 + u.time;
  let r = 0.6;
  let p = vec2f(cos(a), sin(a)) * r;
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

export function defaultCode(type: ShaderType): string {
  switch (type) {
    case "fragment":
      return FRAGMENT_DEFAULT;
    case "compute":
      return COMPUTE_DEFAULT;
    case "render":
      return RENDER_DEFAULT;
  }
}

let counter = 0;
export function newProject(type: ShaderType = "fragment"): Project {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${(counter++).toString(36)}`,
    name: "Untitled",
    type,
    code: defaultCode(type),
    uniforms: [],
    vertexCount: 3,
    createdAt: now,
    updatedAt: now,
  };
}
