import React from "react";
import { DocsThemeConfig } from "nextra-theme-docs";

const repoUrl =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL || process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
    : "https://github.com/user/wizard";

const config: DocsThemeConfig = {
  logo: <span className="font-semibold text-lg">Wizard</span>,
  project: {
    link: repoUrl,
  },
  chat: {
    link: "https://discord.gg/wizardopus",
  },
  docsRepositoryBase: `${repoUrl}/tree/main/packages/docs`,
  footer: {
    text: (
      <span>
        {new Date().getFullYear()} &copy; Wizard - Type-Safe Multi-Step Wizards
        for TypeScript
      </span>
    ),
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta
        property="og:title"
        content="Wizard - Type-Safe Multi-Step Wizards"
      />
      <meta
        property="og:description"
        content="A deeply type-safe, isomorphic, headless multi-step wizard library for TypeScript applications"
      />
      <meta
        name="keywords"
        content="typescript, react, wizard, multi-step, form, state management, type-safe"
      />
      <meta name="author" content="Wizard Team" />
      <link
        rel="icon"
        href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🧙‍♂️</text></svg>"
      />
    </>
  ),
  primaryHue: 220,
  darkMode: true,
  sidebar: {
    defaultMenuCollapseLevel: 2,
    toggleButton: true,
    titleComponent: ({ title, type }: { title: any; type: any }) => {
      if (type === "separator") {
        return (
          <div className="text-xs font-semibold tracking-wide uppercase mt-6 mb-2 opacity-60">
            {title}
          </div>
        );
      }
      return <>{title}</>;
    },
  },
  navigation: {
    prev: true,
    next: true,
  },
  editLink: {
    text: "Edit this page on GitHub →",
  },
  feedback: {
    content: "Questions? Give us feedback →",
    labels: "feedback",
  },
  useNextSeoProps() {
    return {
      titleTemplate: "%s – Wizard Documentation",
      description: "Type-safe multi-step wizards for TypeScript applications",
    };
  },
  toc: {
    backToTop: true,
  },
  search: {
    placeholder: "Search documentation...",
  },
};

export default config;
