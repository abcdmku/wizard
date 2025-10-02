import type { UserRole } from "../../wizard/types";

interface RoleBadgeProps {
  role: UserRole | '';
}

const roleColors = {
  user: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  manager: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  '': "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
};

export function RoleBadge({ role }: RoleBadgeProps) {
  if (!role) return null;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors duration-200 ${roleColors[role]}`}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}