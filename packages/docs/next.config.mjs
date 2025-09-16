import nextra from 'nextra';
import { remarkCodeImport } from './lib/remark-code-import.js';

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
  mdxOptions: {
    remarkPlugins: [remarkCodeImport],
    rehypePlugins: []
  }
});

// GitHub repository name for GitHub Pages deployment
const isProd = process.env.NODE_ENV === 'production';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

// Determine base path based on environment
let basePath = '';
let assetPrefix = '';

if (isProd && isGitHubActions) {
  // When deploying to GitHub Pages, use the repository name as base path
  // Update this to match your actual repository name
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'wizardOpus';
  basePath = `/${repo}`;
  assetPrefix = `/${repo}`;
}

export default withNextra({
  reactStrictMode: true,
  images: {
    unoptimized: true
  },
  transpilePackages: ['@wizard/core', '@wizard/react'],
  basePath,
  assetPrefix,
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  output: 'export',
  trailingSlash: true
});