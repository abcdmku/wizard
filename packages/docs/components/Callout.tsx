import React from 'react';
import { AlertCircle, Info, AlertTriangle, CheckCircle } from 'lucide-react';

export type CalloutType = 'info' | 'warning' | 'error' | 'success';

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}

const icons = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  success: CheckCircle,
};

const styles = {
  info: 'border-blue-500 bg-blue-50 dark:bg-blue-950/50',
  warning: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/50',
  error: 'border-red-500 bg-red-50 dark:bg-red-950/50',
  success: 'border-green-500 bg-green-50 dark:bg-green-950/50',
};

const iconStyles = {
  info: 'text-blue-500',
  warning: 'text-yellow-500',
  error: 'text-red-500',
  success: 'text-green-500',
};

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const Icon = icons[type];

  return (
    <div className={`my-6 flex rounded-lg border-l-4 p-4 ${styles[type]}`}>
      <Icon className={`h-5 w-5 mt-0.5 mr-3 flex-shrink-0 ${iconStyles[type]}`} />
      <div className="flex-1">
        {title && (
          <div className="mb-1 font-semibold">{title}</div>
        )}
        <div className="prose-sm dark:prose-invert">{children}</div>
      </div>
    </div>
  );
}