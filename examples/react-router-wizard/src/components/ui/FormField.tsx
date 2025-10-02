import type { InputHTMLAttributes } from "react";

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: string;
  onChange: (value: string) => void;
  error?: string;
}

export function FormField({
  label,
  error,
  onChange,
  ...props
}: FormFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-100">{label}</label>
      <input
        className={`w-full px-3 py-2 border ${
          error ? "border-red-500 dark:border-red-400" : "border-gray-300 dark:border-gray-600"
        } rounded-md focus:outline-none focus:ring-2 ${
          error ? "focus:ring-red-500 dark:focus:ring-red-400" : "focus:ring-blue-500 dark:focus:ring-blue-400"
        } bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-colors`}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
