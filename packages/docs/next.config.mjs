import nextra from 'nextra';
import { remarkCodeImport } from './lib/remark-code-import.js';

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
  flexsearch: {
    codeblocks: false
  },
  mdxOptions: {
    remarkPlugins: [remarkCodeImport],
    rehypePlugins: []
  }
});

export default withNextra({
  reactStrictMode: true,
  images: {
    unoptimized: true
  },
  transpilePackages: ['@wizard/core', '@wizard/react'],
  basePath: process.env.NODE_ENV === 'production' ? '' : '',
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  output: 'export'
});