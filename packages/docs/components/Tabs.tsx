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
    <div className="my-6">
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            className={`
              px-4 py-2 text-sm font-medium border-b-2 transition-colors
              ${activeIndex === index
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }
            `}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {panels[activeIndex]}
      </div>
    </div>
  );
}

export function Tab({ label, children }: TabProps) {
  return <div>{children}</div>;
}