import React from 'react';
import { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <span>🧙 Wizard</span>,
  project: {
    link: 'https://github.com/MiniBorg/wizardOpus'
  },
  docsRepositoryBase: 'https://github.com/MiniBorg/wizardOpus/tree/main/packages/docs',
  footer: {
    text: (
      <span>
        {new Date().getFullYear()} © Wizard - Type-Safe Multi-Step Wizards
      </span>
    )
  },
  navigation: false,
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta property="og:title" content="Wizard - Type-Safe Multi-Step Wizards" />
      <meta property="og:description" content="A deeply type-safe, isomorphic, headless multi-step wizard library for TypeScript applications" />
    </>
  ),
  primaryHue: 220,
  darkMode: true,
  sidebar: {
    defaultMenuCollapseLevel: 2,
    toggleButton: true,
    titleComponent: ({ title, type }) => {
      if (type === 'separator') {
        return (
          <div style={{ 
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            margin: '1.5rem 0 0.5rem 0',
            opacity: 0.6
          }}>
            {title}
          </div>
        );
      }
      return <>{title}</>;
    }
  },
  navigation: {
    prev: true,
    next: true
  },
  editLink: {
    text: 'Edit this page on GitHub →'
  },
  feedback: {
    content: 'Questions? Give us feedback →',
    labels: 'feedback'
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – Wizard Docs'
    };
  },
  toc: {
    backToTop: true
  },
  search: {
    placeholder: 'Search documentation...'
  }
};

export default config;