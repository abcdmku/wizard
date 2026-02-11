import React, { useState } from "react";
import Link from "next/link";
import { useDarkMode } from "./hooks/useDarkMode";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const isDark = useDarkMode();

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-1.5 text-xs font-medium rounded-md border-none cursor-pointer transition-colors ${
        copied
          ? "bg-emerald-500 text-white"
          : isDark
            ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
            : "bg-gray-200 text-gray-600 hover:bg-gray-300"
      }`}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

const features = [
  {
    title: "Type-Safe",
    description:
      "Full TypeScript inference for step data, transitions, and context. Catch errors at compile time.",
    icon: (
      <svg
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    title: "Headless",
    description:
      "Zero UI opinions. Bring your own components, styles, and design system.",
    icon: (
      <svg
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    title: "React Bindings",
    description:
      "First-class hooks, provider, and router sync utilities for React applications.",
    icon: (
      <svg
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <line x1="21.17" y1="8" x2="12" y2="8" />
        <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
        <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
      </svg>
    ),
  },
  {
    title: "Validation",
    description:
      "Built-in Zod integration for step-level validation with type inference.",
    icon: (
      <svg
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
];

const codeExample = `import { createWizardFactory } from '@wizard/core';

const factory = createWizardFactory<{ userId?: string }>();
const { defineSteps, step } = factory;

const steps = defineSteps({
  start: step({ data: { ok: false }, next: ['done'] }),
  done:  step({ data: { confirmed: false }, next: [] }),
});

export const wizard = factory.createWizard(steps, { context: {} });`;

export function Landing() {
  const isDark = useDarkMode();

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="px-6 pt-20 pb-16 max-w-4xl mx-auto text-center">
        <h1
          className={`text-5xl font-bold tracking-tight mb-4 ${
            isDark ? "text-white" : "text-gray-900"
          }`}
        >
          Type-Safe Multi-Step Wizards
        </h1>
        <p
          className={`text-xl max-w-2xl mx-auto mb-8 ${
            isDark ? "text-gray-400" : "text-gray-600"
          }`}
        >
          A deeply type-safe, isomorphic, headless wizard library for TypeScript
          and React. Define steps, transitions, and validation with full
          inference.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link
            href="/getting-started"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors no-underline"
          >
            Get Started
          </Link>
          <Link
            href="/examples"
            className={`px-6 py-3 rounded-lg font-medium text-sm border transition-colors no-underline ${
              isDark
                ? "border-gray-700 text-gray-300 hover:bg-gray-800"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            View Examples
          </Link>
        </div>
      </section>

      {/* Install Command */}
      <section className="px-6 pb-16 max-w-2xl mx-auto">
        <div
          className={`flex items-center justify-between rounded-lg px-5 py-3 font-mono text-sm ${
            isDark
              ? "bg-gray-900 border border-gray-800"
              : "bg-gray-50 border border-gray-200"
          }`}
        >
          <code className={isDark ? "text-gray-300" : "text-gray-700"}>
            npm install @wizard/core @wizard/react
          </code>
          <CopyButton text="npm install @wizard/core @wizard/react" />
        </div>
      </section>

      {/* Feature Grid */}
      <section className="px-6 pb-16 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`p-5 rounded-xl border transition-colors ${
                isDark
                  ? "bg-gray-900/50 border-gray-800 hover:border-gray-700"
                  : "bg-white border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-blue-500 mb-3">{feature.icon}</div>
              <h3
                className={`text-base font-semibold mb-1 ${
                  isDark ? "text-gray-200" : "text-gray-900"
                }`}
              >
                {feature.title}
              </h3>
              <p
                className={`text-sm leading-relaxed m-0 ${
                  isDark ? "text-gray-400" : "text-gray-600"
                }`}
              >
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Code Example */}
      <section className="px-6 pb-16 max-w-4xl mx-auto">
        <h2
          className={`text-2xl font-bold mb-4 text-center ${
            isDark ? "text-gray-200" : "text-gray-900"
          }`}
        >
          Define Your Wizard
        </h2>
        <p
          className={`text-center mb-6 ${isDark ? "text-gray-400" : "text-gray-600"}`}
        >
          The canonical authoring pattern &mdash; fully type-safe from step
          definitions to runtime.
        </p>
        <div
          className={`rounded-xl overflow-hidden border ${
            isDark ? "border-gray-800" : "border-gray-200"
          }`}
        >
          <div
            className={`flex items-center justify-between px-4 py-2.5 text-xs font-medium ${
              isDark
                ? "bg-gray-900 text-gray-400 border-b border-gray-800"
                : "bg-gray-50 text-gray-500 border-b border-gray-200"
            }`}
          >
            <span>wizard.ts</span>
            <CopyButton text={codeExample} />
          </div>
          <pre
            className={`m-0 p-5 text-[13px] leading-relaxed font-mono overflow-x-auto ${
              isDark
                ? "bg-[#0a0a0a] text-gray-300"
                : "bg-[#f8fafc] text-gray-700"
            }`}
          >
            <code>{codeExample}</code>
          </pre>
        </div>
      </section>

      {/* Footer */}
      <footer
        className={`px-6 py-10 text-center text-sm border-t ${
          isDark
            ? "border-gray-800 text-gray-500"
            : "border-gray-200 text-gray-500"
        }`}
      >
        <div className="flex gap-6 justify-center mb-4">
          <Link
            href="/getting-started"
            className={`no-underline hover:underline ${isDark ? "text-gray-400" : "text-gray-600"}`}
          >
            Docs
          </Link>
          <Link
            href="/api-docs"
            className={`no-underline hover:underline ${isDark ? "text-gray-400" : "text-gray-600"}`}
          >
            API Reference
          </Link>
          <Link
            href="/examples"
            className={`no-underline hover:underline ${isDark ? "text-gray-400" : "text-gray-600"}`}
          >
            Examples
          </Link>
        </div>
        <p className="m-0">
          {new Date().getFullYear()} &copy; Wizard &mdash; Type-Safe Multi-Step
          Wizards for TypeScript
        </p>
      </footer>
    </div>
  );
}
