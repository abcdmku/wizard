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

// GitHub Pages deployment configuration
const isProd = process.env.NODE_ENV === 'production';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

// Determine base path based on environment
let basePath = '';
let assetPrefix = '';

if (isProd && isGitHubActions) {
  // When deploying to GitHub Pages, dynamically extract repository name from GitHub Actions
  // GITHUB_REPOSITORY is provided by GitHub Actions in format: owner/repo
  const githubRepo = process.env.GITHUB_REPOSITORY;
  
  if (githubRepo) {
    // Extract just the repository name from owner/repo format
    const repoName = githubRepo.split('/')[1];
    
    // For GitHub Pages, the path is /repo-name unless it's a user/org page (username.github.io)
    // Check if this is a user/org page (repo name matches username.github.io pattern)
    const [owner] = githubRepo.split('/');
    const isUserPage = repoName === `${owner}.github.io`;
    
    if (!isUserPage) {
      // Standard project page: https://username.github.io/repo-name
      basePath = `/${repoName}`;
      assetPrefix = `/${repoName}`;
    }
    // If it's a user page, keep basePath and assetPrefix empty
  }
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