import React from 'react';
import { DocsThemeConfig } from 'nextra-theme-docs';

// Get repository info from environment or use defaults
const repoUrl = process.env.NEXT_PUBLIC_GITHUB_REPO_URL || 
                process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : 
                'https://github.com/user/wizard';

const config: DocsThemeConfig = {
  logo: <span>🧙 Wizard</span>,
  project: {
    link: repoUrl
  },
  docsRepositoryBase: `${repoUrl}/tree/main/packages/docs`,
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
      <style>{`
        /* Override code block colors */
        pre, pre code, .shiki, .shiki pre, .shiki code {
          background: #2d2d30 !important;
        }
        
        /* Better tab styling for code blocks */
        [data-nextra-code-tabs] > [role="tablist"] {
          background: #f9fafb !important;
          border-radius: 8px 8px 0 0 !important;
          padding: 4px !important;
          gap: 4px !important;
          display: flex !important;
          border-bottom: 1px solid #e5e7eb !important;
        }
        
        [data-nextra-code-tabs] button[role="tab"] {
          background: transparent !important;
          border: none !important;
          padding: 0.5rem 1rem !important;
          border-radius: 6px !important;
          font-size: 0.875rem !important;
          font-weight: 500 !important;
          color: #6b7280 !important;
          transition: all 0.2s !important;
        }
        
        [data-nextra-code-tabs] button[role="tab"]:hover {
          background: #f3f4f6 !important;
        }
        
        [data-nextra-code-tabs] button[role="tab"][data-state="active"] {
          background: white !important;
          color: #3b82f6 !important;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1) !important;
        }
        
        /* Code block container styling */
        [data-nextra-code-tabs] pre {
          border-radius: 0 0 8px 8px !important;
          margin-top: 0 !important;
        }
        
        /* Single code blocks without tabs */
        article pre:not([data-nextra-code-tabs] pre) {
          border-radius: 8px !important;
          background: #2d2d30 !important;
        }
        
        /* Inline code */
        :not(pre) > code {
          background: rgba(0, 0, 0, 0.05) !important;
          padding: 0.125rem 0.375rem !important;
          border-radius: 0.25rem !important;
        }
        
        .dark :not(pre) > code {
          background: rgba(255, 255, 255, 0.1) !important;
        }
      `}</style>
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