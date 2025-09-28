import type { UserRole } from "../../wizard/types";

interface RoleBadgeProps {
  role: UserRole | '';
}

const roleColors = {
  user: "bg-blue-100 text-blue-800",
  admin: "bg-red-100 text-red-800",
  manager: "bg-green-100 text-green-800",
  '': "bg-gray-100 text-gray-800",
};

export function RoleBadge({ role }: RoleBadgeProps) {
  if (!role) return null;
  
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleColors[role]}`}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}