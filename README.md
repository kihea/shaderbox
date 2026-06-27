# ShaderBox

A local, Shadertoy-style playground for writing, previewing, and saving shaders
— right in your browser, no account, no server. Pick a backend per sandbox:

- **WebGPU · WGSL** — fragment, **compute**, and render (vertex+fragment) shaders.
- **WebGL2 · GLSL** — fragment and render shaders (GLSL ES 3.00). No compute
  stage exists in WebGL2, so compute is WebGPU-only.

Each sandbox remembers which backend it targets, so GLSL and WGSL shaders live
side by side in the same project list.

## Features

- **Three shader modes** — fragment (fullscreen, Shadertoy-like), compute
  (writes a storage texture, WGSL only), and render (your own vertex + fragment
  stages).
- **Multipass buffers** — a project is an ordered list of passes. The last pass
  is the **Image** (renders to screen); earlier ones are **Buffer A/B/…** that
  render to offscreen textures and are double-buffered, so a pass can read its
  own previous frame (feedback).
- **iChannels** — each pass has 4 input channels (`iChannel0..3`) bindable to
  another pass's output or an uploaded image. A compute pass's output texture is
  bindable as a channel too, so compute results can feed a later fragment or
  render pass.
- **Monaco code editor**, bundled locally (works fully offline) with WGSL and
  GLSL syntax highlighting and inline compile-error squiggles.
- **Custom "outside" variables** — add `float` / `vec2` / `vec3` / `vec4` /
  `color` uniforms from the UI and drive them live with sliders and color
  pickers while the shader runs. No recompile needed to change a value.
- **Built-in uniforms** available to every shader: `resolution`, `time`,
  `timeDelta`, `frame`, and `mouse` (xy = cursor, zw = last click).
- **Save / load** — everything is persisted to `localStorage` automatically.
  Export any shader to a `.json` file and import it back to share.
- **Playback controls** — pause, reset time, and a live FPS readout.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

Build a static bundle with `npm run build` and preview it with `npm run preview`.

> **Browser support:** WGSL sandboxes need a browser with WebGPU (recent
> Chrome / Edge / other Chromium). If WebGPU isn't available, the preview pane
> tells you and you can still use the WebGL2 (GLSL) backend, which works
> everywhere WebGL2 does.

## How a shader is wired up

A hidden prelude is injected before your code so you can focus on the
interesting part. The prelude exposes the uniforms (built-ins plus your custom
ones) and, depending on the mode, the entry points you implement.

Every pass also gets a sampler and four input textures. In WGSL:
`iSampler` (binding 1) and `iChannel0..3` (bindings 2–5); compute passes also
get `outImage` (binding 6). In GLSL: `uniform sampler2D iChannel0..3` and
`uniform vec2 iChannelResolution[4]`. Sample a channel with
`textureSample(iChannel0, iSampler, in.uv)` (WGSL) or `texture(iChannel0, uv)`
(GLSL).

### WGSL (WebGPU)

The uniforms are a struct bound at `@group(0) @binding(0)`, referenced as
`u.<name>` (e.g. `u.time`, `u.resolution`, `u.channelRes0`, and any custom
uniform `u.myValue`).

| Mode      | You write                                              | Prelude also provides |
|-----------|--------------------------------------------------------|-----------------------|
| fragment  | `fs_main(in: VertexOutput) -> @location(0) vec4f`      | `vs_main` (fullscreen triangle), `in.uv`, `in.pos` |
| compute   | `@compute @workgroup_size(8,8) fn cs_main(...)`        | `outImage: texture_storage_2d<rgba8unorm, write>` |
| render    | `vs_main` + `fs_main`                                   | uniforms only; draws `vertexCount` vertices |

### GLSL (WebGL2)

The uniforms are plain globals (`time`, `resolution`, `mouse`, and any custom
uniform `myValue`). Shaders are GLSL ES 3.00.

| Mode      | You write                                              | Notes |
|-----------|--------------------------------------------------------|-------|
| fragment  | `void main()` assigning `fragColor`                    | `uv` in `[0,1]` provided |
| render    | vertex stage, then a `//--- fragment` marker line, then the fragment stage | both stages share the uniform set; draws `vertexCount` vertices via `gl_VertexID` |

## Tech

Vite + React + TypeScript. Two interchangeable engines (`WebGPUEngine`,
`WebGL2Engine`) implement a common `IEngine` interface; the preview picks one
based on the sandbox's backend. Uniform packing for WGSL replicates the
uniform-address-space alignment rules so a manually packed buffer matches the
auto-generated `struct Uniforms` byte-for-byte.

## Project layout

```
src/
  engine/
    types.ts          shared types + IEngine interface
    uniforms.ts       WGSL uniform layout + Float32Array packer
    defaults.ts       default WGSL/GLSL for each mode
    WebGPUEngine.ts   WebGPU/WGSL renderer (fragment, compute, render)
    WebGL2Engine.ts   WebGL2/GLSL renderer (fragment, render)
  ui/
    Preview.tsx       owns the canvas + engine for the active sandbox
    Editor.tsx        Monaco editor + error markers (per active pass)
    PassBar.tsx       pass tabs, per-pass type, add/delete buffer
    InspectorPanel.tsx  tabbed Channels / Uniforms / Assets panel
    ChannelControls.tsx iChannel binding selectors
    AssetManager.tsx  image upload + library
    UniformControls.tsx custom-uniform sliders / color pickers
    Sidebar.tsx       project list, new/duplicate/export/import
    wgslLanguage.ts   Monaco WGSL + GLSL grammars
  storage/store.ts    localStorage persistence + JSON export/import (+migration)
  App.tsx             app shell + state
```
