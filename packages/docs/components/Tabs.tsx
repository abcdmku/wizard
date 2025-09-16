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
      <div className="flex gap-1 p-1 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            className={`
              px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-all duration-200
              ${activeIndex === index 
                ? 'bg-white dark:bg-gray-900 text-blue-500 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200'
              }
            `}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="bg-white dark:bg-[#0b0b0b] border border-gray-200 dark:border-gray-700 border-t-0 rounded-b-lg">
        <div className="p-0">
          {panels[activeIndex]}
        </div>
      </div>
    </div>
  );
}

export function Tab({ label, children }: TabProps) {
  return <div>{children}</div>;
}