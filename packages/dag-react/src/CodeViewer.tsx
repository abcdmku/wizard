import * as React from 'react';
import Editor from '@monaco-editor/react';

type Props = {
  code: string | Function;
  language?: string;
};

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
        height="200px"
        language={language}
        value={formattedCode}
        theme={isDark ? 'vs-dark' : 'light'}
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
