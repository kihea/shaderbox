import MonacoEditor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { registerWgsl } from "./wgslLanguage";
import type { ShaderError } from "../engine/types";

interface Props {
  code: string;
  errors: ShaderError[];
  onChange: (code: string) => void;
}

export function Editor({ code, errors, onChange }: Props) {
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
        language="wgsl"
        theme="vs-dark"
        value={code}
        beforeMount={(monaco) => registerWgsl(monaco)}
        onMount={(ed, monaco) => {
          editorRef.current = ed;
          monacoRef.current = monaco as typeof import("monaco-editor");
          setMarkers();
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
