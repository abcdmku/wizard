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
        marginBottom: '0',
        borderRadius: '8px 8px 0 0',
        padding: '4px',
        gap: '4px'
      }}
      className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            className={`
              px-4 py-2 text-sm font-medium border-none rounded-md cursor-pointer transition-all duration-200
              ${activeIndex === index 
                ? 'bg-white dark:bg-gray-900 text-blue-500 dark:text-blue-400 shadow-sm' 
                : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }
            `}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 border-t-0 rounded-b-lg p-4">
        {panels[activeIndex]}
      </div>
    </div>
  );
}

export function Tab({ label, children }: TabProps) {
  return <div>{children}</div>;
}