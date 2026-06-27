import type { CustomUniform, UniformType } from "./types";

/**
 * WGSL uniform-address-space layout rules per scalar/vector type.
 * We replicate WGSL's natural alignment so a manually packed Float32Array
 * matches the auto-generated `struct Uniforms { ... }` byte-for-byte, as long
 * as field order is preserved.
 */
interface TypeInfo {
  align: number;
  size: number;
  comps: number;
  wgsl: string;
}

export const TYPE_INFO: Record<UniformType, TypeInfo> = {
  float: { align: 4, size: 4, comps: 1, wgsl: "f32" },
  vec2: { align: 8, size: 8, comps: 2, wgsl: "vec2<f32>" },
  vec3: { align: 16, size: 12, comps: 3, wgsl: "vec3<f32>" },
  vec4: { align: 16, size: 16, comps: 4, wgsl: "vec4<f32>" },
  // a color is just an rgb vec3 with a dedicated UI control
  color: { align: 16, size: 12, comps: 3, wgsl: "vec3<f32>" },
};

export function componentCount(t: UniformType): number {
  return TYPE_INFO[t].comps;
}

interface Field {
  name: string;
  type: UniformType;
  offset: number; // byte offset
  comps: number;
}

export interface UniformLayout {
  fields: Field[];
  byteSize: number;
  wgslStruct: string;
}

/** Built-in uniforms available to every shader, in fixed leading order. */
const BUILTINS: { name: string; type: UniformType }[] = [
  { name: "resolution", type: "vec2" },
  { name: "time", type: "float" },
  { name: "timeDelta", type: "float" },
  { name: "frame", type: "float" },
  { name: "mouse", type: "vec4" },
  { name: "channelRes0", type: "vec2" },
  { name: "channelRes1", type: "vec2" },
  { name: "channelRes2", type: "vec2" },
  { name: "channelRes3", type: "vec2" },
];

function roundUp(n: number, multiple: number): number {
  return Math.ceil(n / multiple) * multiple;
}

/** Build the byte layout + matching WGSL struct for built-ins plus customs. */
export function buildUniformLayout(customs: CustomUniform[]): UniformLayout {
  const all = [
    ...BUILTINS,
    ...customs.map((c) => ({ name: c.name, type: c.type })),
  ];

  const fields: Field[] = [];
  let offset = 0;
  for (const f of all) {
    const info = TYPE_INFO[f.type];
    offset = roundUp(offset, info.align);
    fields.push({ name: f.name, type: f.type, offset, comps: info.comps });
    offset += info.size;
  }
  const byteSize = Math.max(16, roundUp(offset, 16));

  const lines = fields.map((f) => `  ${f.name}: ${TYPE_INFO[f.type].wgsl},`);
  const wgslStruct = `struct Uniforms {\n${lines.join("\n")}\n};`;

  return { fields, byteSize, wgslStruct };
}

/**
 * Pack current uniform values into a Float32Array sized to the layout.
 * `values` maps custom-uniform name -> component array. Built-ins are passed
 * explicitly.
 */
export function packUniforms(
  layout: UniformLayout,
  builtins: {
    resolution: [number, number];
    time: number;
    timeDelta: number;
    frame: number;
    mouse: [number, number, number, number];
    /** Resolution of each of the 4 channels (0,0 when unbound). */
    channelRes: [number, number][];
  },
  customValues: Record<string, number[]>,
): Float32Array {
  const buf = new Float32Array(layout.byteSize / 4);
  const builtinMap: Record<string, number[]> = {
    resolution: builtins.resolution,
    time: [builtins.time],
    timeDelta: [builtins.timeDelta],
    frame: [builtins.frame],
    mouse: builtins.mouse,
    channelRes0: builtins.channelRes[0] ?? [0, 0],
    channelRes1: builtins.channelRes[1] ?? [0, 0],
    channelRes2: builtins.channelRes[2] ?? [0, 0],
    channelRes3: builtins.channelRes[3] ?? [0, 0],
  };

  for (const f of layout.fields) {
    const src = builtinMap[f.name] ?? customValues[f.name] ?? [];
    const base = f.offset / 4;
    for (let i = 0; i < f.comps; i++) buf[base + i] = src[i] ?? 0;
  }
  return buf;
}
