import { useTheme } from "../../src/theme/theme-provider";

export function useDarkMode() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark";
}
