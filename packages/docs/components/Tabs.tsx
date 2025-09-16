import React, { useState } from 'react';

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
  const panels = React.Children.toArray(children);

  return (
    <div style={{ margin: '1.5rem 0' }}>
      <div style={{ 
        display: 'flex',
        borderBottom: '1px solid #e5e7eb',
        marginBottom: '0',
        background: '#f9fafb',
        borderRadius: '8px 8px 0 0',
        padding: '4px',
        gap: '4px'
      }}>
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: activeIndex === index ? 'white' : 'transparent',
              color: activeIndex === index ? '#3b82f6' : '#6b7280',
              boxShadow: activeIndex === index ? '0 1px 3px 0 rgba(0, 0, 0, 0.1)' : 'none'
            }}
            onMouseEnter={(e) => {
              if (activeIndex !== index) {
                e.currentTarget.style.background = '#f3f4f6';
              }
            }}
            onMouseLeave={(e) => {
              if (activeIndex !== index) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div style={{ 
        background: 'white',
        border: '1px solid #e5e7eb',
        borderTop: 'none',
        borderRadius: '0 0 8px 8px',
        padding: '1rem'
      }}>
        {panels[activeIndex]}
      </div>
    </div>
  );
}

export function Tab({ label, children }: TabProps) {
  return <div>{children}</div>;
}