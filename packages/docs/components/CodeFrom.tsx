import React, { useEffect, useState } from 'react';
import { CopyButton } from './CopyButton';

interface CodeFromProps {
  src: string;
  lines?: string;
  highlight?: string;
  language?: string;
  title?: string;
}

export function CodeFrom({ src, lines, highlight, language = 'typescript', title }: CodeFromProps) {
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadCode = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // For client-side, we'll need to fetch from public directory
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`Failed to load code from ${src}`);
        }
        
        let text = await response.text();
        
        // Process line ranges if specified
        if (lines) {
          const lineRanges = parseLineRanges(lines);
          const allLines = text.split('\n');
          const selectedLines: string[] = [];
          
          lineRanges.forEach(range => {
            for (let i = range.start - 1; i < range.end; i++) {
              if (allLines[i] !== undefined) {
                selectedLines.push(allLines[i]);
              }
            }
          });
          
          text = selectedLines.join('\n');
        }
        
        setCode(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load code');
      } finally {
        setLoading(false);
      }
    };

    loadCode();
  }, [src, lines]);

  if (loading) {
    return (
      <div className="my-4 p-4 rounded-lg bg-gray-100 dark:bg-gray-800">
        <div className="text-sm text-gray-500">Loading code...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="my-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <div className="text-sm text-red-600 dark:text-red-400">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="my-4">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-t-lg border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium">{title}</span>
          <CopyButton text={code} />
        </div>
      )}
      <pre className={`language-${language} ${title ? 'rounded-b-lg' : 'rounded-lg'}`}>
        <code className={`language-${language}`}>{code}</code>
        {!title && (
          <div className="absolute top-2 right-2">
            <CopyButton text={code} />
          </div>
        )}
      </pre>
    </div>
  );
}

function parseLineRanges(lines: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const parts = lines.split(',');
  
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