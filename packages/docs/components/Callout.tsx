import React from 'react';
import { AlertCircle, Info, AlertTriangle, CheckCircle, Lightbulb } from 'lucide-react';

export type CalloutType = 'info' | 'warning' | 'error' | 'success' | 'tip';

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
  tip: Lightbulb,
};

const styles = {
  info: 'border-blue-500 bg-blue-50 dark:bg-blue-950/50',
  warning: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/50',
  error: 'border-red-500 bg-red-50 dark:bg-red-950/50',
  success: 'border-green-500 bg-green-50 dark:bg-green-950/50',
  tip: 'border-purple-500 bg-purple-50 dark:bg-purple-950/50',
};

const iconStyles = {
  info: 'text-blue-500',
  warning: 'text-yellow-500',
  error: 'text-red-500',
  success: 'text-green-500',
  tip: 'text-purple-500',
};

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const Icon = icons[type];

  return (
    <div 
      style={{
        margin: '1.5rem 0',
        padding: '1rem',
        borderRadius: '0.5rem',
        borderLeft: '4px solid',
        display: 'flex',
        gap: '0.75rem',
        backgroundColor: type === 'info' ? 'rgba(59, 130, 246, 0.1)' :
                         type === 'warning' ? 'rgba(245, 158, 11, 0.1)' :
                         type === 'error' ? 'rgba(239, 68, 68, 0.1)' :
                         type === 'success' ? 'rgba(34, 197, 94, 0.1)' :
                         'rgba(168, 85, 247, 0.1)',
        borderLeftColor: type === 'info' ? '#3b82f6' :
                        type === 'warning' ? '#f59e0b' :
                        type === 'error' ? '#ef4444' :
                        type === 'success' ? '#22c55e' :
                        '#a855f7'
      }}
    >
      <Icon 
        style={{
          width: '20px',
          height: '20px',
          flexShrink: 0,
          marginTop: '2px',
          color: type === 'info' ? '#3b82f6' :
                 type === 'warning' ? '#f59e0b' :
                 type === 'error' ? '#ef4444' :
                 type === 'success' ? '#22c55e' :
                 '#a855f7'
        }}
      />
      <div style={{ flex: 1 }}>
        {title && (
          <div style={{ 
            fontWeight: 600, 
            marginBottom: '0.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {title}
          </div>
        )}
        <div style={{ fontSize: '0.95rem', lineHeight: '1.6' }}>{children}</div>
      </div>
    </div>
  );
}