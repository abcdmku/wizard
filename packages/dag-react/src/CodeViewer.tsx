import * as React from 'react';
import Editor from '@monaco-editor/react';

type Props = {
  code: string;
  language?: string;
};

export function CodeViewer({ code, language = 'typescript' }: Props) {
  const formattedCode = typeof code === 'function' ? code.toString() : String(code);

  return (
    <div className="wiz-code-viewer">
      <Editor
        height="200px"
        language={language}
        value={formattedCode}
        theme="vs-dark"
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineNumbers: 'off',
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          renderLineHighlight: 'none',
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          wordWrap: 'on',
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}
