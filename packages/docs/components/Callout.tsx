import React from "react";
import {
  AlertCircle,
  Info,
  AlertTriangle,
  CheckCircle,
  Lightbulb,
} from "lucide-react";

export type CalloutType = "info" | "warning" | "error" | "success" | "tip";

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
  info: "border-blue-500 bg-blue-50 dark:bg-blue-950/50",
  warning: "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/50",
  error: "border-red-500 bg-red-50 dark:bg-red-950/50",
  success: "border-green-500 bg-green-50 dark:bg-green-950/50",
  tip: "border-purple-500 bg-purple-50 dark:bg-purple-950/50",
};

const iconStyles = {
  info: "text-blue-500",
  warning: "text-yellow-500",
  error: "text-red-500",
  success: "text-green-500",
  tip: "text-purple-500",
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  const Icon = icons[type];

  return (
    <div
      className={`my-6 p-4 rounded-lg border-l-4 flex gap-3 ${styles[type]}`}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconStyles[type]}`} />
      <div className="flex-1">
        {title && (
          <div className="font-semibold mb-1 flex items-center gap-2">
            {title}
          </div>
        )}
        <div className="text-[0.95rem] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
