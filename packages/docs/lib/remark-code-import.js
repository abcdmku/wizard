import { promises as fs } from 'fs';
import path from 'path';
import { visit } from 'unist-util-visit';

const EXAMPLES_DIR = path.join(process.cwd(), '../../examples');
const PACKAGES_DIR = path.join(process.cwd(), '../../packages');

export function remarkCodeImport() {
  return async (tree, file) => {
    const promises = [];

    visit(tree, 'code', (node) => {
      if (node.meta && node.meta.includes('file=')) {
        const fileMatch = node.meta.match(/file="([^"]+)"/);
        if (fileMatch) {
          const filePath = fileMatch[1];
          const lineMatch = node.meta.match(/lines="([^"]+)"/);
          const lines = lineMatch ? lineMatch[1] : null;

          promises.push(
            (async () => {
              try {
                let fullPath;

                if (filePath.startsWith('@examples/')) {
                  const examplePath = filePath.replace('@examples/', '');
                  fullPath = path.join(EXAMPLES_DIR, examplePath);
                } else if (filePath.startsWith('@wizard/')) {
                  const packagePath = filePath.replace('@wizard/', '');
                  fullPath = path.join(PACKAGES_DIR, packagePath);
                } else {
                  fullPath = path.join(process.cwd(), filePath);
                }

                // Check if file exists before reading
                try {
                  await fs.access(fullPath);
                } catch (accessError) {
                  throw new Error(`File not found: ${fullPath}`);
                }

                let content = await fs.readFile(fullPath, 'utf-8');
                
                if (lines) {
                  content = extractLines(content, lines);
                }

                node.value = content;
                
                // Add filename as title if not present
                if (!node.lang || !node.lang.includes('title=')) {
                  const filename = path.basename(filePath);
                  node.lang = node.lang ? `${node.lang} title="${filename}"` : `title="${filename}"`;
                }
              } catch (error) {
                console.error(`Failed to import code from ${filePath}:`, error);
                node.value = `// Error loading file: ${filePath}\n// ${error.message}`;
              }
            })()
          );
        }
      }
    });

    await Promise.all(promises);
  };
}

function extractLines(content, linesStr) {
  const lines = content.split('\n');
  const ranges = parseLineRanges(linesStr);
  const extracted = [];

  for (const range of ranges) {
    for (let i = range.start - 1; i < range.end && i < lines.length; i++) {
      extracted.push(lines[i]);
    }
  }

  return extracted.join('\n');
}

function parseLineRanges(linesStr) {
  const ranges = [];
  const parts = linesStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(s => parseInt(s.trim(), 10));
      ranges.push({ start, end });
    } else {
      const lineNum = parseInt(trimmed, 10);
      ranges.push({ start: lineNum, end: lineNum });
    }
  }

  return ranges;
}