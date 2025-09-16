import React from 'react';

interface StepsProps {
  children: React.ReactNode;
}

interface StepProps {
  title: string;
  children: React.ReactNode;
}

export function Steps({ children }: StepsProps) {
  const steps = React.Children.toArray(children);
  
  return (
    <div className="my-8 space-y-6">
      {steps.map((step, index) => (
        <div key={index} className="flex gap-4">
          <div className="flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white font-semibold text-sm">
              {index + 1}
            </div>
          </div>
          <div className="flex-1 pb-8 last:pb-0">
            {step}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Step({ title, children }: StepProps) {
  return (
    <div>
      <h3 className="font-semibold text-lg mb-2">{title}</h3>
      <div className="prose-sm dark:prose-invert">{children}</div>
    </div>
  );
}