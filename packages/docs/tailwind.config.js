/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,md,mdx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./mdx-components.tsx",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "code-bg": "#f8fafc",
        "code-bg-dark": "#0a0a0a",
        "code-border": "#e2e8f0",
        "code-border-dark": "#2d2d30",
        "code-header": "#f9fafb",
        "code-header-dark": "#1a1a1a",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          '"SF Mono"',
          "Consolas",
          '"Liberation Mono"',
          "Menlo",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
