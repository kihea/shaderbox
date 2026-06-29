import MonacoEditor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { registerLanguages } from "./wgslLanguage";
import type { ShaderBackend, ShaderError } from "../engine/types";

export interface EditorApi {
  /** Insert text at the cursor (replacing any selection) and refocus. */
  insert: (text: string) => void;
}

interface Props {
  code: string;
  backend: ShaderBackend;
  errors: ShaderError[];
  onChange: (code: string) => void;
  onReady?: (api: EditorApi) => void;
}

export function Editor({ code, backend, errors, onChange, onReady }: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);

  function setMarkers() {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;
    const markers = errors
      .filter((e) => e.line !== undefined)
      .map((e) => ({
        startLineNumber: e.line!,
        endLineNumber: e.line!,
        startColumn: 1,
        endColumn: model.getLineMaxColumn(Math.min(e.line!, model.getLineCount())),
        message: e.message,
        severity:
          e.type === "error"
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
      }));
    monaco.editor.setModelMarkers(model, "shaderbox", markers);
  }

  // refresh squiggles whenever the compile errors change
  useEffect(setMarkers, [errors]);

  return (
    <div className="editor">
      <MonacoEditor
        language={backend === "webgpu" ? "wgsl" : "glsl"}
        theme="vs-dark"
        value={code}
        beforeMount={(monaco) => registerLanguages(monaco)}
        onMount={(ed, monaco) => {
          editorRef.current = ed;
          monacoRef.current = monaco as typeof import("monaco-editor");
          setMarkers();
          onReady?.({
            insert: (text: string) => {
              const sel = ed.getSelection();
              if (sel) ed.executeEdits("inputs", [{ range: sel, text, forceMoveMarkers: true }]);
              ed.focus();
            },
          });
        }}
        onChange={(v) => onChange(v ?? "")}
        options={{
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          fontLigatures: true,
        }}
      />
    </div>
  );
}
