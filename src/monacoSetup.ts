// Bundle Monaco locally instead of fetching it from a CDN, so ShaderBox works
// fully offline as a local tool.
// Import the slim editor API (no bundled languages/workers); we register our
// own WGSL + GLSL grammars, so none of Monaco's built-in language packs ship.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

// We only ever edit WGSL/GLSL (registered as custom languages), so the base
// editor worker is all we need — no TS/JSON/CSS language workers.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });
