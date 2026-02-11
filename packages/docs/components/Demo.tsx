import React, { useState } from "react";
import { useDarkMode } from "./hooks/useDarkMode";

interface DemoProps {
  title?: string;
  description?: string;
  height?: string | number;
  children: React.ReactNode;
}

export function Demo({
  title = "Live Demo",
  description,
  height = 400,
  children,
}: DemoProps) {
  const isDark = useDarkMode();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCode, setShowCode] = useState(false);

  let demoContent = null;
  let codeContent = null;

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.props.className?.includes("demo-content")) {
        demoContent = child;
      } else if (
        child.type === "pre" ||
        child.props.className?.includes("language-")
      ) {
        codeContent = child;
      }
    }
  });

  const containerStyle: React.CSSProperties = isFullscreen
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        width: "100vw",
        height: "100vh",
      }
    : {};

  const heightValue = typeof height === "number" ? `${height}px` : height;

  if (demoContent) {
    return (
      <div
        className={`my-8 rounded-xl overflow-hidden border ${
          isDark ? "border-gray-700 bg-[#0f0f0f]" : "border-gray-200 bg-white"
        }`}
        style={containerStyle}
      >
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${
            isDark
              ? "bg-[#1a1a1a] border-gray-700"
              : "bg-gray-50 border-gray-200"
          }`}
        >
          <div>
            <h3
              className={`text-sm font-semibold m-0 flex items-center gap-2 ${
                isDark ? "text-gray-200" : "text-gray-900"
              }`}
            >
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {title}
            </h3>
            {description && (
              <p
                className={`text-xs m-0 mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {description}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {codeContent && (
              <button
                onClick={() => setShowCode(!showCode)}
                className={`px-3 py-1.5 text-xs font-medium border-none rounded-md cursor-pointer transition-colors flex items-center gap-1 ${
                  isDark
                    ? "bg-gray-700/50 text-gray-400 hover:bg-gray-700/80"
                    : "bg-white text-gray-500 hover:bg-gray-100"
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                {showCode ? "Hide Code" : "Show Code"}
              </button>
            )}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className={`px-3 py-1.5 text-xs font-medium border-none rounded-md cursor-pointer transition-colors flex items-center gap-1 ${
                isDark
                  ? "bg-gray-700/50 text-gray-400 hover:bg-gray-700/80"
                  : "bg-white text-gray-500 hover:bg-gray-100"
              }`}
            >
              {isFullscreen ? (
                <>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                  </svg>
                  Exit
                </>
              ) : (
                <>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                  Expand
                </>
              )}
            </button>
          </div>
        </div>
        <div
          className={`overflow-y-auto ${isDark ? "bg-[#0a0a0a]" : "bg-white"}`}
          style={{
            padding: "24px",
            height: isFullscreen ? "calc(100vh - 57px)" : heightValue,
          }}
        >
          {demoContent}
        </div>
        {showCode && codeContent && (
          <div
            className={`max-h-[400px] overflow-y-auto border-t ${
              isDark ? "border-gray-700" : "border-gray-200"
            }`}
          >
            {codeContent}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`my-8 rounded-xl overflow-hidden border ${
        isDark ? "border-gray-700 bg-[#0f0f0f]" : "border-gray-200 bg-white"
      }`}
      style={containerStyle}
    >
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${
          isDark ? "bg-[#1a1a1a] border-gray-700" : "bg-gray-50 border-gray-200"
        }`}
      >
        <h3
          className={`text-sm font-semibold m-0 flex items-center gap-2 ${
            isDark ? "text-gray-200" : "text-gray-900"
          }`}
        >
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          {title}
        </h3>
      </div>
      <div className="p-0">{children}</div>
    </div>
  );
}

export function InlineDemo({ children }: { children: React.ReactNode }) {
  const isDark = useDarkMode();

  return (
    <div
      className={`p-4 my-4 rounded-lg border ${
        isDark ? "border-gray-700 bg-gray-900/50" : "border-gray-200 bg-gray-50"
      }`}
    >
      {children}
    </div>
  );
}

export function Playground({
  code,
  language = "typescript",
  editable = false,
  title = "Playground",
}: {
  code: string;
  language?: string;
  editable?: boolean;
  title?: string;
}) {
  const [currentCode, setCurrentCode] = useState(code);
  const [output, setOutput] = useState<string>("");
  const isDark = useDarkMode();

  const runCode = () => {
    try {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => {
        logs.push(
          args
            .map((a) =>
              typeof a === "object" ? JSON.stringify(a, null, 2) : String(a),
            )
            .join(" "),
        );
      };

      const func = new Function(currentCode);
      const result = func();

      console.log = originalLog;

      if (logs.length > 0) {
        setOutput(logs.join("\n"));
      } else if (result !== undefined) {
        setOutput(JSON.stringify(result, null, 2));
      } else {
        setOutput("Code executed successfully");
      }
    } catch (error: any) {
      setOutput(`Error: ${error.message}`);
    }
  };

  return (
    <div
      className={`my-8 rounded-xl overflow-hidden border ${
        isDark ? "border-gray-700" : "border-gray-200"
      }`}
    >
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${
          isDark ? "bg-[#1a1a1a] border-gray-700" : "bg-gray-50 border-gray-200"
        }`}
      >
        <span
          className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-900"}`}
        >
          {title}
        </span>
        {editable && (
          <button
            onClick={runCode}
            className="px-3 py-1.5 text-xs font-medium border-none rounded-md cursor-pointer bg-blue-500 text-white flex items-center gap-1 hover:bg-blue-600"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run
          </button>
        )}
      </div>
      <div
        className="grid h-[400px]"
        style={{ gridTemplateColumns: output ? "1fr 1fr" : "1fr" }}
      >
        <div
          className={isDark ? "bg-[#0b0b0b]" : "bg-[#1e1e1e]"}
          style={{ padding: "16px" }}
        >
          {editable ? (
            <textarea
              value={currentCode}
              onChange={(e) => setCurrentCode(e.target.value)}
              spellCheck={false}
              className="w-full h-full bg-transparent text-[#d4d4d4] border-none outline-none font-mono text-[13px] leading-relaxed resize-none"
            />
          ) : (
            <pre className="m-0 text-[#d4d4d4] font-mono text-[13px] leading-relaxed">
              <code>{currentCode}</code>
            </pre>
          )}
        </div>
        {output && (
          <div
            className={`p-4 overflow-auto border-l ${
              isDark
                ? "bg-gray-900 border-gray-700"
                : "bg-gray-100 border-gray-200"
            }`}
          >
            <div
              className={`text-xs font-semibold mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              Output:
            </div>
            <pre
              className={`m-0 font-mono text-[13px] leading-relaxed whitespace-pre-wrap ${
                isDark ? "text-gray-200" : "text-gray-900"
              }`}
            >
              <code>{output}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
