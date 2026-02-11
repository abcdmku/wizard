import React, { useState } from "react";
import { useDarkMode } from "./hooks/useDarkMode";

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
  const isDark = useDarkMode();
  const panels = React.Children.toArray(children);

  return (
    <div
      className={`my-6 rounded-xl overflow-hidden border ${
        isDark ? "border-[#2d2d30]" : "border-gray-200"
      }`}
    >
      {/* Tab Header */}
      <div
        className={`flex gap-0.5 p-0.5 ${
          isDark ? "bg-gray-800/30" : "bg-gray-50"
        }`}
      >
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            className={`
              flex-1 py-2.5 px-4 text-[13px] font-mono border-none rounded-lg
              cursor-pointer transition-all duration-150
              ${
                activeIndex === index
                  ? isDark
                    ? "font-semibold bg-gray-900/80 text-blue-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_1px_2px_0_rgba(0,0,0,0.3)]"
                    : "font-semibold bg-white text-blue-600 shadow-sm"
                  : isDark
                    ? "font-medium text-gray-400 hover:bg-gray-700/30 hover:text-gray-300"
                    : "font-medium text-gray-500 hover:bg-gray-100/80 hover:text-gray-600"
              }
            `}
          >
            {item}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div
        className={`min-h-[200px] relative ${
          isDark ? "bg-[#0b0b0b]" : "bg-[#1e1e1e]"
        }`}
      >
        {panels[activeIndex]}
      </div>
    </div>
  );
}

export function Tab({ label, children }: TabProps) {
  return <>{children}</>;
}
