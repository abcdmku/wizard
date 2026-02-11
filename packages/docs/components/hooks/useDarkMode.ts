import { useTheme } from "next-themes";

export function useDarkMode() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark";
}
