import type { Monaco } from "@monaco-editor/react";

let registered = false;

/** Register a lightweight WGSL syntax highlighter with Monaco. */
export function registerWgsl(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "wgsl" });

  monaco.languages.setLanguageConfiguration("wgsl", {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
    ],
  });

  monaco.languages.setMonarchTokensProvider("wgsl", {
    keywords: [
      "fn", "let", "var", "const", "return", "if", "else", "for", "while",
      "loop", "break", "continue", "switch", "case", "default", "struct",
      "type", "true", "false", "discard", "override", "alias",
    ],
    builtins: [
      "vec2", "vec3", "vec4", "mat2x2", "mat3x3", "mat4x4", "vec2f", "vec3f",
      "vec4f", "vec2i", "vec3i", "vec4i", "vec2u", "vec3u", "vec4u",
      "f32", "i32", "u32", "bool", "atomic", "array", "ptr", "sampler",
      "texture_2d", "texture_storage_2d", "texture_cube",
    ],
    functions: [
      "sin", "cos", "tan", "abs", "floor", "ceil", "fract", "mix", "clamp",
      "min", "max", "pow", "exp", "log", "sqrt", "length", "distance", "dot",
      "cross", "normalize", "reflect", "refract", "smoothstep", "step", "sign",
      "atan", "atan2", "textureSample", "textureSampleLevel", "textureStore",
      "textureLoad", "dpdx", "dpdy", "select",
    ],
    annotations: [
      "@vertex", "@fragment", "@compute", "@builtin", "@location", "@group",
      "@binding", "@workgroup_size", "@interpolate",
    ],
    tokenizer: {
      root: [
        [/@[a-zA-Z_]\w*/, "annotation"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@builtins": "type",
              "@functions": "predefined",
              "@default": "identifier",
            },
          },
        ],
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/-?\d+\.\d*([eE][-+]?\d+)?[fh]?/, "number.float"],
        [/-?\d+[fhiu]?/, "number"],
        [/[{}()\[\]]/, "@brackets"],
        [/[<>=!+\-*/%&|^~.]+/, "operator"],
        [/"/, "string", "@string"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      string: [
        [/[^"]+/, "string"],
        [/"/, "string", "@pop"],
      ],
    },
  });
}
