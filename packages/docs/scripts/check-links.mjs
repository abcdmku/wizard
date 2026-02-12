#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const docsRoot = resolve(__dirname, '..');
const pagesRoot = resolve(docsRoot, 'pages');

const allowedAbsolutePrefixes = ['/typedoc/', '/typedoc', '/pagefind/', '/pagefind'];

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function normalizeRouteSlug(rawSlug) {
  if (rawSlug === 'index') return '';
  if (rawSlug.endsWith('/index')) {
    return rawSlug.slice(0, -'/index'.length);
  }
  return rawSlug;
}

function normalizePath(value) {
  const withoutHash = value.split('#')[0] ?? '';
  const withoutQuery = withoutHash.split('?')[0] ?? '';
  if (!withoutQuery) return '/';
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed || '/';
}

function lineFromIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function listFiles(dirPath, extensions) {
  const files = [];

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, extensions));
      continue;
    }

    if (extensions.has(extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function getDocRoutes() {
  const mdxFiles = listFiles(pagesRoot, new Set(['.mdx']));
  const slugs = new Set();
  const routes = new Set(['/']);

  for (const filePath of mdxFiles) {
    const relativeToPages = toPosix(relative(pagesRoot, filePath)).replace(/\.mdx$/, '');
    const slug = normalizeRouteSlug(relativeToPages);
    slugs.add(slug);
    routes.add(slug ? `/${slug}` : '/');
  }

  return { routes, slugs };
}

function parseLinkTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1);
  }

  const firstToken = trimmed.split(/\s+/)[0];
  return firstToken || null;
}

function resolveRelativeDocTarget(filePath, target) {
  const absoluteBase = resolve(dirname(filePath), target);
  const extension = extname(absoluteBase);
  if (extension) {
    return existsSync(absoluteBase);
  }

  const directMdx = `${absoluteBase}.mdx`;
  if (existsSync(directMdx)) {
    return true;
  }

  const nestedIndex = resolve(absoluteBase, 'index.mdx');
  return existsSync(nestedIndex);
}

function checkInternalLinks(routes) {
  const files = listFiles(pagesRoot, new Set(['.mdx', '.md']));
  const errors = [];

  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/g;

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf8');
    const relativePath = toPosix(relative(docsRoot, filePath));

    for (const match of content.matchAll(markdownLinkPattern)) {
      const index = match.index ?? 0;
      const line = lineFromIndex(content, index);
      const rawTarget = parseLinkTarget(match[1] ?? '');
      if (!rawTarget) continue;

      if (rawTarget.startsWith('http://') || rawTarget.startsWith('https://')) continue;
      if (rawTarget.startsWith('mailto:') || rawTarget.startsWith('tel:')) continue;
      if (rawTarget.startsWith('#')) continue;
      if (rawTarget.startsWith('//')) continue;

      if (rawTarget.startsWith('/')) {
        const normalized = normalizePath(rawTarget);
        if (
          allowedAbsolutePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix))
        ) {
          continue;
        }
        if (!routes.has(normalized)) {
          errors.push(`${relativePath}:${line} broken internal link "${rawTarget}"`);
        }
        continue;
      }

      if (rawTarget.startsWith('./') || rawTarget.startsWith('../')) {
        if (!resolveRelativeDocTarget(filePath, rawTarget)) {
          errors.push(`${relativePath}:${line} broken relative link "${rawTarget}"`);
        }
      }
    }

    for (const match of content.matchAll(hrefPattern)) {
      const index = match.index ?? 0;
      const line = lineFromIndex(content, index);
      const target = (match[1] ?? '').trim();
      if (!target || !target.startsWith('/')) continue;
      if (target.startsWith('//')) continue;

      const normalized = normalizePath(target);
      if (
        allowedAbsolutePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix))
      ) {
        continue;
      }

      if (!routes.has(normalized)) {
        errors.push(`${relativePath}:${line} broken href "${target}"`);
      }
    }
  }

  return errors;
}

function checkHardcodedSplatSlugs(slugs) {
  const sourceRoots = [resolve(docsRoot, 'src'), resolve(docsRoot, 'components')];
  const errors = [];

  for (const root of sourceRoots) {
    if (!existsSync(root)) continue;

    const files = listFiles(root, new Set(['.ts', '.tsx', '.mdx']));
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf8');
      const relativePath = toPosix(relative(docsRoot, filePath));
      const splatPattern = /_splat:\s*['"]([^'"]+)['"]/g;

      for (const match of content.matchAll(splatPattern)) {
        const index = match.index ?? 0;
        const line = lineFromIndex(content, index);
        const slug = (match[1] ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
        if (!slug) {
          errors.push(`${relativePath}:${line} invalid empty _splat slug`);
          continue;
        }
        if (!slugs.has(slug)) {
          errors.push(`${relativePath}:${line} unknown _splat slug "${slug}"`);
        }
      }
    }
  }

  return errors;
}

function main() {
  const { routes, slugs } = getDocRoutes();
  const errors = [...checkInternalLinks(routes), ...checkHardcodedSplatSlugs(slugs)];

  if (errors.length > 0) {
    console.error('[check-links] Route/link issues detected:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('[check-links] Internal docs links and hardcoded route slugs are valid.');
}

main();
