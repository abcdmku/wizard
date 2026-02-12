import * as React from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';

type Props = {
  code: string | Function;
  language?: string;
};

const PHOTO_EDITOR_THEME = 'wizard-photo-dark';

function configurePhotoEditorTheme(monaco: Monaco) {
  monaco.editor.defineTheme(PHOTO_EDITOR_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955' },
      { token: 'keyword', foreground: 'C586C0' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'regexp', foreground: 'D16969' },
      { token: 'identifier', foreground: '9CDCFE' },
      { token: 'variable', foreground: '9CDCFE' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'type.identifier', foreground: '4EC9B0' },
      { token: 'function', foreground: 'DCDCAA' },
      { token: 'delimiter', foreground: 'D4D4D4' },
      { token: 'operator', foreground: 'D4D4D4' },
    ],
    colors: {
      'editor.background': '#1E1E1E',
      'editor.foreground': '#D4D4D4',
      'editorLineNumber.foreground': '#6E7681',
      'editorLineNumber.activeForeground': '#D4D4D4',
      'editorCursor.foreground': '#AEAFAD',
      'editor.selectionBackground': '#264F78',
      'editor.inactiveSelectionBackground': '#3A3D41',
      'editorIndentGuide.background1': '#404040',
      'editorIndentGuide.activeBackground1': '#707070',
      'editorBracketHighlight.foreground1': '#FFD700',
      'editorBracketHighlight.foreground2': '#DA70D6',
      'editorBracketHighlight.foreground3': '#4EC9B0',
      'editorBracketHighlight.foreground4': '#569CD6',
      'editorBracketHighlight.foreground5': '#D7BA7D',
      'editorBracketHighlight.foreground6': '#C586C0',
      'editorBracketHighlight.unexpectedBracket.foreground': '#F44747',
    },
  });
}

export function CodeViewer({ code, language = 'typescript' }: Props) {
  const formattedCode = typeof code === 'function' ? code.toString() : String(code);

  // Detect theme by checking if background is dark
  const [isDark, setIsDark] = React.useState(true);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkTheme = () => {
      // Check the background color of the document body
      const bgColor = window.getComputedStyle(document.body).backgroundColor;
      // Parse RGB and calculate luminance
      const rgb = bgColor.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const [r, g, b] = rgb.map(Number);
        // Calculate relative luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        setIsDark(luminance < 0.5);
      }
    };

    checkTheme();
    // Re-check theme periodically in case it changes
    const interval = setInterval(checkTheme, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="wiz-code-viewer">
      <Editor
        beforeMount={configurePhotoEditorTheme}
        height="200px"
        language={language}
        value={formattedCode}
        theme={isDark ? PHOTO_EDITOR_THEME : 'light'}
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
          bracketPairColorization: { enabled: true },
          wordWrap: 'on',
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}
