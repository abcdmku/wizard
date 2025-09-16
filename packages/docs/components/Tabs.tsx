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
    // Check if dark mode is active
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    
    checkDarkMode();
    // Watch for dark mode changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ margin: '1.5rem 0' }}>
      <div style={{ 
        display: 'flex',
        gap: '4px',
        padding: '4px',
        backgroundColor: isDark ? 'rgba(31, 41, 55, 0.5)' : '#f9fafb',
        borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
        borderRadius: '8px 8px 0 0'
      }}>
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: 500,
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              backgroundColor: activeIndex === index 
                ? (isDark ? '#111827' : '#ffffff')
                : 'transparent',
              color: activeIndex === index 
                ? (isDark ? '#60a5fa' : '#3b82f6')
                : (isDark ? '#9ca3af' : '#6b7280'),
              boxShadow: activeIndex === index 
                ? '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
                : 'none'
            }}
            onMouseEnter={(e) => {
              if (activeIndex !== index) {
                e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6';
              }
            }}
            onMouseLeave={(e) => {
              if (activeIndex !== index) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div style={{
        backgroundColor: isDark ? '#0b0b0b' : '#ffffff',
        border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
        borderTop: 'none',
        borderRadius: '0 0 8px 8px',
        overflow: 'hidden'
      }}>
        {panels[activeIndex]}
      </div>
    </div>
  );
}

export function Tab({ label, children }: TabProps) {
  return <div>{children}</div>;
}