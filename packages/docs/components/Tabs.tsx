import React, { useState, useEffect } from 'react';

interface TabsProps {
  items: string[];
  children: React.ReactNode;
  defaultIndex?: number;
}

interface TabProps {
  label: string;
  children: React.ReactNode;
}

export function Tabs({ items, children, defaultIndex = 0 }: TabsProps) {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const [isDark, setIsDark] = useState(false);
  const panels = React.Children.toArray(children);

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
      margin: '1.5rem 0',
      borderRadius: '12px',
      overflow: 'hidden',
      border: `1px solid ${isDark ? '#2d2d30' : '#e5e7eb'}`
    }}>
      {/* Tab Header */}
      <div style={{ 
        display: 'flex',
        gap: '2px',
        padding: '2px',
        backgroundColor: isDark ? 'rgba(31, 41, 55, 0.3)' : '#f9fafb',
      }}>
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            style={{
              flex: 1,
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: activeIndex === index ? 600 : 500,
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backgroundColor: activeIndex === index 
                ? (isDark ? 'rgba(17, 24, 39, 0.8)' : '#ffffff')
                : 'transparent',
              color: activeIndex === index 
                ? (isDark ? '#60a5fa' : '#2563eb')
                : (isDark ? '#9ca3af' : '#6b7280'),
              boxShadow: activeIndex === index 
                ? isDark 
                  ? 'inset 0 1px 0 0 rgba(255, 255, 255, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.3)'
                  : '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                : 'none',
              transform: activeIndex === index ? 'scale(1)' : 'scale(0.98)',
            }}
            onMouseEnter={(e) => {
              if (activeIndex !== index) {
                e.currentTarget.style.backgroundColor = isDark 
                  ? 'rgba(55, 65, 81, 0.3)' 
                  : 'rgba(243, 244, 246, 0.8)';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeIndex !== index) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.transform = 'scale(0.98)';
              }
            }}
          >
            {item}
          </button>
        ))}
      </div>
      
      {/* Tab Content */}
      <div style={{
        backgroundColor: isDark ? '#0b0b0b' : '#1e1e1e',
        minHeight: '200px',
        position: 'relative',
      }}>
        {panels[activeIndex]}
      </div>
    </div>
  );
}

export function Tab({ label, children }: TabProps) {
  return <>{children}</>;
}