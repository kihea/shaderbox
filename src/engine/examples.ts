import {
  emptyChannels,
  NUM_CHANNELS,
  type Channel,
  type Pass,
  type Project,
  type ShaderBackend,
  type ShaderType,
} from "./types";

/**
 * A pass within an example. Channels are specified by *local key* (another
 * pass's `key`) or `image:<id>`; they're resolved to real ids on instantiate.
 */
interface PassTemplate {
  key: string;
  name: string;
  type: ShaderType;
  code: string;
  vertexCount?: number;
  channels?: (string | null)[];
}

export interface ExampleTemplate {
  id: string;
  title: string;
  backend: ShaderBackend;
  description: string;
  passes: PassTemplate[];
}

let counter = 0;
function uid(tag: string): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}-${tag}`;
}

function buildChannels(spec: (string | null)[] | undefined, keyToId: Map<string, string>): Channel[] {
  const ch = emptyChannels();
  spec?.forEach((s, i) => {
    if (!s || i >= NUM_CHANNELS) return;
    if (s.startsWith("image:")) ch[i] = { source: "image", imageId: s.slice(6) };
    else if (keyToId.has(s)) ch[i] = { source: "pass", passId: keyToId.get(s)! };
  });
  return ch;
}

/** Create a fresh, fully-editable project from an example template. */
export function instantiateExample(t: ExampleTemplate): Project {
  const now = Date.now();
  const keyToId = new Map<string, string>();
  for (const p of t.passes) keyToId.set(p.key, uid("pass"));
  const passes: Pass[] = t.passes.map((p) => ({
    id: keyToId.get(p.key)!,
    name: p.name,
    type: p.type,
    code: p.code,
    vertexCount: p.vertexCount ?? 3,
    channels: buildChannels(p.channels, keyToId),
  }));
  return {
    id: uid("proj"),
    name: t.title,
    backend: t.backend,
    passes,
    uniforms: [],
    images: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ------------------------------------------------------------------ templates

const COMPUTE_RINGS = `// Compute pass: write animated rings to outImage.
@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2f(u.resolution);
  if (f32(gid.x) >= dims.x || f32(gid.y) >= dims.y) { return; }
  let uv = vec2f(f32(gid.x), f32(gid.y)) / dims;
  let d = length(uv - 0.5);
  let c = 0.5 + 0.5 * cos(vec3f(d * 40.0 - u.time * 3.0) + vec3f(0.0, 2.0, 4.0));
  textureStore(outImage, vec2i(gid.xy), vec4f(c, 1.0));
}`;

const RENDER_SAMPLE_CHANNEL = `// Render pass: draw a triangle, texture it with iChannel0 (Buffer A).
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var P  = array<vec2f, 3>(vec2f(-0.8, -0.7), vec2f(0.8, -0.7), vec2f(0.0, 0.85));
  var UV = array<vec2f, 3>(vec2f(0.0, 0.0),  vec2f(1.0, 0.0),  vec2f(0.5, 1.0));
  var o: VSOut;
  o.pos = vec4f(P[vi], 0.0, 1.0);
  o.uv = UV[vi];
  return o;
}
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  return textureSample(iChannel0, iSampler, in.uv);
}`;

const WGSL_TRIANGLE_PLASMA = `// Plasma computed per-fragment, mapped onto the triangle via a UV varying.
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var P  = array<vec2f, 3>(vec2f(-0.7, -0.6), vec2f(0.7, -0.6), vec2f(0.0, 0.75));
  var UV = array<vec2f, 3>(vec2f(0.0, 0.0),  vec2f(1.0, 0.0),  vec2f(0.5, 1.0));
  var o: VSOut;
  o.pos = vec4f(P[vi], 0.0, 1.0);
  o.uv = UV[vi];
  return o;
}
fn plasma(uv: vec2f, t: f32) -> vec3f {
  let p = uv * 6.0;
  var v = sin(p.x + t);
  v += sin(p.y + t * 1.3);
  v += sin((p.x + p.y) * 0.5 + t * 0.7);
  v += sin(length(p - 3.0) - t * 2.0);
  v = v * 0.25 + 0.5;
  return vec3f(
    0.5 + 0.5 * cos(6.28318 * (v + 0.0)),
    0.5 + 0.5 * cos(6.28318 * (v + 0.33)),
    0.5 + 0.5 * cos(6.28318 * (v + 0.67)),
  );
}
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  return vec4f(plasma(in.uv, u.time), 1.0);
}`;

const GLSL_FEEDBACK = `// Buffer A blends a moving plasma with its own previous frame (a trail).
void main() {
  vec3 prev = texture(iChannel0, uv).rgb;        // iChannel0 -> Buffer A (self)
  vec3 c = 0.5 + 0.5 * cos(time + uv.xyx * 3.0 + vec3(0.0, 2.0, 4.0));
  fragColor = vec4(mix(c, prev, 0.92), 1.0);
}`;

const GLSL_SHOW_CHANNEL = `// Image pass: show Buffer A on screen.
void main() {
  fragColor = texture(iChannel0, uv);            // iChannel0 -> Buffer A
}`;

export const EXAMPLES: ExampleTemplate[] = [
  {
    id: "compute-render",
    title: "Compute → Render",
    backend: "webgpu",
    description: "A compute pass writes a texture; a render pass maps it onto a triangle.",
    passes: [
      { key: "bufA", name: "Buffer A", type: "compute", code: COMPUTE_RINGS },
      { key: "image", name: "Image", type: "render", code: RENDER_SAMPLE_CHANNEL, channels: ["bufA"] },
    ],
  },
  {
    id: "triangle-plasma",
    title: "Plasma on a triangle",
    backend: "webgpu",
    description: "Render pass (vertex + fragment) painting the plasma onto a triangle's surface.",
    passes: [{ key: "image", name: "Image", type: "render", code: WGSL_TRIANGLE_PLASMA }],
  },
  {
    id: "feedback",
    title: "Feedback buffer (GLSL)",
    backend: "webgl2",
    description: "A buffer reads its own previous frame for a trail, then the Image shows it.",
    passes: [
      { key: "bufA", name: "Buffer A", type: "fragment", code: GLSL_FEEDBACK, channels: ["bufA"] },
      { key: "image", name: "Image", type: "fragment", code: GLSL_SHOW_CHANNEL, channels: ["bufA"] },
    ],
  },
];
