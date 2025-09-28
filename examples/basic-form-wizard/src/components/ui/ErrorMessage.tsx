interface ErrorMessageProps {
  message: string;
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
      {message}
    </div>
  );
}