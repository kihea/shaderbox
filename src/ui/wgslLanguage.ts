import type { Monaco } from "@monaco-editor/react";

let registered = false;

/** Register lightweight WGSL + GLSL syntax highlighters with Monaco. */
export function registerLanguages(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  registerWgslImpl(monaco);
  registerGlslImpl(monaco);
}

function registerGlslImpl(monaco: Monaco): void {
  monaco.languages.register({ id: "glsl" });
  monaco.languages.setLanguageConfiguration("glsl", {
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
  monaco.languages.setMonarchTokensProvider("glsl", {
    keywords: [
      "void", "bool", "int", "uint", "float", "double", "if", "else", "for",
      "while", "do", "return", "break", "continue", "discard", "struct",
      "const", "uniform", "in", "out", "inout", "layout", "precision",
      "highp", "mediump", "lowp", "true", "false", "switch", "case", "default",
    ],
    builtins: [
      "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3",
      "uvec4", "mat2", "mat3", "mat4", "sampler2D", "sampler3D", "samplerCube",
      "gl_Position", "gl_VertexID", "gl_FragCoord", "gl_PointSize",
    ],
    functions: [
      "sin", "cos", "tan", "asin", "acos", "atan", "pow", "exp", "log",
      "sqrt", "abs", "sign", "floor", "ceil", "fract", "mod", "min", "max",
      "clamp", "mix", "step", "smoothstep", "length", "distance", "dot",
      "cross", "normalize", "reflect", "refract", "texture", "textureLod",
      "dFdx", "dFdy",
    ],
    tokenizer: {
      root: [
        [/#\w+/, "keyword.directive"],
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
        [/-?\d+\.\d*([eE][-+]?\d+)?[fF]?/, "number.float"],
        [/-?\d+[uU]?/, "number"],
        [/[{}()\[\]]/, "@brackets"],
        [/[<>=!+\-*/%&|^~.?:]+/, "operator"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });
}

function registerWgslImpl(monaco: Monaco): void {
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
