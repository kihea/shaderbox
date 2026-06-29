import { NUM_CHANNELS, type Pass, type Project } from "../engine/types";
import { passLabel } from "./passLabel";

export interface InputItem {
  /** Identifier shown and inserted into the editor. */
  token: string;
  type: string;
  desc: string;
  /** Extra note, e.g. a channel's current binding. */
  note?: string;
}

export interface InputGroup {
  label: string;
  /** How to use this group, shown as a small hint. */
  hint?: string;
  items: InputItem[];
}

/** What is `iChannelN` currently bound to, as a human label. */
function channelBinding(project: Project, pass: Pass, i: number): string {
  const c = pass.channels[i];
  if (c?.source === "pass" && c.passId) {
    const idx = project.passes.findIndex((p) => p.id === c.passId);
    if (idx >= 0) return `→ ${passLabel(project.passes, idx)}${c.passId === pass.id ? " (self)" : ""}`;
  }
  if (c?.source === "image" && c.imageId) {
    const img = project.images.find((m) => m.id === c.imageId);
    if (img) return `→ ${img.name}`;
  }
  return "unbound";
}

/** Build the list of inputs available to the given pass, backend-aware. */
export function buildInputs(project: Project, pass: Pass): InputGroup[] {
  const wgsl = project.backend === "webgpu";
  const p = (n: string) => (wgsl ? `u.${n}` : n);
  const groups: InputGroup[] = [];

  groups.push({
    label: "Built-ins",
    items: [
      { token: p("resolution"), type: wgsl ? "vec2f" : "vec2", desc: "viewport size in pixels" },
      { token: p("time"), type: wgsl ? "f32" : "float", desc: "seconds since start" },
      { token: p("timeDelta"), type: wgsl ? "f32" : "float", desc: "seconds since last frame" },
      { token: p("frame"), type: wgsl ? "f32" : "float", desc: "frame counter" },
      { token: p("mouse"), type: wgsl ? "vec4f" : "vec4", desc: "xy = cursor px, zw = last click px" },
    ],
  });

  // contextual to the pass type
  if (pass.type === "fragment") {
    groups.push({
      label: "Fragment",
      items: wgsl
        ? [
            { token: "in.uv", type: "vec2f", desc: "fragment UV in [0,1]" },
            { token: "in.pos", type: "vec4f", desc: "builtin pixel position" },
          ]
        : [
            { token: "uv", type: "vec2", desc: "fragment UV in [0,1]" },
            { token: "fragColor", type: "vec4", desc: "output color (assign this)" },
          ],
    });
  } else if (pass.type === "compute") {
    groups.push({
      label: "Compute",
      hint: wgsl ? "write with textureStore(outImage, vec2i(gid.xy), color)" : undefined,
      items: [
        { token: "outImage", type: "texture_storage_2d", desc: "this pass's output (write-only)" },
        { token: "@builtin(global_invocation_id)", type: "vec3u", desc: "invocation id (declare as a param)" },
      ],
    });
  } else {
    groups.push({
      label: "Render",
      items: wgsl
        ? [{ token: "@builtin(vertex_index)", type: "u32", desc: "vertex index (declare as a param)" }]
        : [
            { token: "gl_VertexID", type: "int", desc: "vertex index" },
            { token: "gl_Position", type: "vec4", desc: "clip-space output (vertex stage)" },
            { token: "fragColor", type: "vec4", desc: "output color (fragment stage)" },
          ],
    });
  }

  // channels
  const channelItems: InputItem[] = [];
  for (let i = 0; i < NUM_CHANNELS; i++) {
    channelItems.push({
      token: `iChannel${i}`,
      type: wgsl ? "texture_2d<f32>" : "sampler2D",
      desc: "input channel",
      note: channelBinding(project, pass, i),
    });
  }
  if (wgsl) channelItems.push({ token: "iSampler", type: "sampler", desc: "use with textureSample" });
  channelItems.push({
    token: p(wgsl ? "channelRes0" : "iChannelResolution[0]"),
    type: wgsl ? "vec2f" : "vec2",
    desc: "resolution of channel 0 (…1,2,3)",
  });
  groups.push({
    label: "Channels",
    hint: wgsl ? "textureSample(iChannel0, iSampler, in.uv)" : "texture(iChannel0, uv)",
    items: channelItems,
  });

  // custom uniforms
  if (project.uniforms.length) {
    groups.push({
      label: "Custom uniforms",
      items: project.uniforms.map((u) => ({
        token: p(u.name),
        type: u.type,
        desc: "custom uniform",
      })),
    });
  }

  return groups;
}
