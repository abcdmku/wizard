import React, { useState, useEffect } from 'react';

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
  children 
}: DemoProps) {
  const [isDark, setIsDark] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    
    return () => observer.disconnect();
  }, []);

  // Extract demo content and code from children
  let demoContent = null;
  let codeContent = null;
  
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.props.className?.includes('demo-content')) {
        demoContent = child;
      } else if (child.type === 'pre' || child.props.className?.includes('language-')) {
        codeContent = child;
      }
    }
  });

  const containerStyle: React.CSSProperties = {
    margin: '2rem 0',
    borderRadius: '12px',
    overflow: 'hidden',
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
    backgroundColor: isDark ? '#0f0f0f' : '#ffffff',
    position: isFullscreen ? 'fixed' : 'relative',
    top: isFullscreen ? 0 : 'auto',
    left: isFullscreen ? 0 : 'auto',
    right: isFullscreen ? 0 : 'auto',
    bottom: isFullscreen ? 0 : 'auto',
    zIndex: isFullscreen ? 9999 : 'auto',
    width: isFullscreen ? '100vw' : '100%',
    height: isFullscreen ? '100vh' : 'auto',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    backgroundColor: isDark ? '#1a1a1a' : '#f9fafb',
    borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 600,
    color: isDark ? '#e5e7eb' : '#111827',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    backgroundColor: isDark ? 'rgba(55, 65, 81, 0.5)' : '#ffffff',
    color: isDark ? '#9ca3af' : '#6b7280',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  };

  const contentStyle: React.CSSProperties = {
    padding: demoContent ? '24px' : '0',
    height: isFullscreen ? 'calc(100vh - 57px)' : typeof height === 'number' ? `${height}px` : height,
    overflowY: 'auto',
    backgroundColor: isDark ? '#0a0a0a' : '#ffffff',
  };

  // If we have demo content, show it above the code
  if (demoContent) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <div>
            <h3 style={titleStyle}>
              <span style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#10b981',
                animation: 'pulse 2s infinite',
              }} />
              {title}
            </h3>
            {description && (
              <p style={{
                fontSize: '12px',
                color: isDark ? '#9ca3af' : '#6b7280',
                margin: '4px 0 0 0',
              }}>
                {description}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {codeContent && (
              <button
                style={buttonStyle}
                onClick={() => setShowCode(!showCode)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = isDark ? 'rgba(55, 65, 81, 0.8)' : '#f3f4f6';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = isDark ? 'rgba(55, 65, 81, 0.5)' : '#ffffff';
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                {showCode ? 'Hide Code' : 'Show Code'}
              </button>
            )}
            <button
              style={buttonStyle}
              onClick={() => setIsFullscreen(!isFullscreen)}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(55, 65, 81, 0.8)' : '#f3f4f6';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(55, 65, 81, 0.5)' : '#ffffff';
              }}
            >
              {isFullscreen ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                  </svg>
                  Exit
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                  Expand
                </>
              )}
            </button>
          </div>
        </div>
        <div style={contentStyle}>
          {demoContent}
        </div>
        {showCode && codeContent && (
          <div style={{
            borderTop: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
            maxHeight: '400px',
            overflowY: 'auto',
          }}>
            {codeContent}
          </div>
        )}
        <style jsx>{`
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
            }
            50% {
              opacity: 0.5;
            }
          }
        `}</style>
      </div>
    );
  }

  // Fallback: just render children with basic container
  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>
          <span style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#10b981',
            animation: 'pulse 2s infinite',
          }} />
          {title}
        </h3>
      </div>
      <div style={{ padding: 0 }}>
        {children}
      </div>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        `}</style>
    </div>
  );
}

// Wrapper component for inline demos (smaller, simpler)
export function InlineDemo({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{
      padding: '16px',
      margin: '16px 0',
      borderRadius: '8px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      backgroundColor: isDark ? 'rgba(17, 24, 39, 0.5)' : '#f9fafb',
    }}>
      {children}
    </div>
  );
}

// Interactive code playground component
export function Playground({ 
  code, 
  language = 'typescript',
  editable = false,
  title = "Playground"
}: {
  code: string;
  language?: string;
  editable?: boolean;
  title?: string;
}) {
  const [currentCode, setCurrentCode] = useState(code);
  const [output, setOutput] = useState<string>('');
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    
    return () => observer.disconnect();
  }, []);

  const runCode = () => {
    try {
      // Create a safe console.log capture
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => {
        logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
      };
      
      // Simple evaluation for demo purposes
      // In production, you'd want to use a sandboxed environment
      const func = new Function(currentCode);
      const result = func();
      
      console.log = originalLog;
      
      if (logs.length > 0) {
        setOutput(logs.join('\n'));
      } else if (result !== undefined) {
        setOutput(JSON.stringify(result, null, 2));
      } else {
        setOutput('Code executed successfully');
      }
    } catch (error: any) {
      setOutput(`Error: ${error.message}`);
    }
  };

  return (
    <div style={{
      margin: '2rem 0',
      borderRadius: '12px',
      overflow: 'hidden',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: isDark ? '#1a1a1a' : '#f9fafb',
        borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 600,
          color: isDark ? '#e5e7eb' : '#111827',
        }}>
          {title}
        </span>
        {editable && (
          <button
            onClick={runCode}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 500,
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run
          </button>
        )}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: output ? '1fr 1fr' : '1fr',
        height: '400px',
      }}>
        <div style={{
          padding: '16px',
          backgroundColor: isDark ? '#0b0b0b' : '#1e1e1e',
          overflow: 'auto',
        }}>
          {editable ? (
            <textarea
              value={currentCode}
              onChange={(e) => setCurrentCode(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: 'transparent',
                color: '#d4d4d4',
                border: 'none',
                outline: 'none',
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: '13px',
                lineHeight: '1.6',
                resize: 'none',
              }}
            />
          ) : (
            <pre style={{
              margin: 0,
              color: '#d4d4d4',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: '13px',
              lineHeight: '1.6',
            }}>
              <code>{currentCode}</code>
            </pre>
          )}
        </div>
        {output && (
          <div style={{
            padding: '16px',
            backgroundColor: isDark ? '#111827' : '#f3f4f6',
            borderLeft: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
            overflow: 'auto',
          }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: isDark ? '#9ca3af' : '#6b7280',
              marginBottom: '8px',
            }}>
              Output:
            </div>
            <pre style={{
              margin: 0,
              color: isDark ? '#e5e7eb' : '#111827',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: '13px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
            }}>
              <code>{output}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}