import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useDarkMode } from "./hooks/useDarkMode";

/* ── tiny helpers ─────────────────────────────────────────── */

function CopyButton({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={`px-2 py-1 text-[11px] font-medium rounded border-none cursor-pointer transition-all ${
        copied
          ? "bg-emerald-500/20 text-emerald-400"
          : "bg-white/5 text-gray-500 hover:text-gray-300"
      } ${className}`}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/* ── animated step flow ───────────────────────────────────── */

const STEPS = [
  { id: "info", label: "Info", color: "#3b82f6" },
  { id: "plan", label: "Plan", color: "#8b5cf6" },
  { id: "pay", label: "Pay", color: "#f59e0b" },
  { id: "done", label: "Done", color: "#10b981" },
];

function StepFlow() {
  const [active, setActive] = useState(0);
  const isDark = useDarkMode();

  useEffect(() => {
    const id = setInterval(
      () => setActive((i) => (i + 1) % STEPS.length),
      1800,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2 select-none">
      {STEPS.map((s, i) => {
        const state = i < active ? "done" : i === active ? "active" : "pending";
        return (
          <React.Fragment key={s.id}>
            {i > 0 && (
              <div
                className="h-px flex-1 min-w-[24px] transition-colors duration-500"
                style={{
                  backgroundColor:
                    i <= active ? s.color : isDark ? "#2d3748" : "#e2e8f0",
                }}
              />
            )}
            <button
              onClick={() => setActive(i)}
              className="relative flex flex-col items-center gap-1.5 group cursor-pointer bg-transparent border-none p-0"
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold transition-all duration-500 shrink-0"
                style={{
                  backgroundColor:
                    state === "pending"
                      ? isDark
                        ? "#1a202c"
                        : "#f1f5f9"
                      : state === "done"
                        ? `${s.color}33`
                        : s.color,
                  color:
                    state === "active"
                      ? "#fff"
                      : state === "done"
                        ? s.color
                        : isDark
                          ? "#64748b"
                          : "#94a3b8",
                  boxShadow:
                    state === "active"
                      ? `0 0 0 3px ${s.color}44, 0 4px 12px ${s.color}33`
                      : "none",
                  transform: state === "active" ? "scale(1.15)" : "scale(1)",
                }}
              >
                {state === "done" ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className="text-[11px] font-medium transition-colors"
                style={{
                  color:
                    state !== "pending"
                      ? s.color
                      : isDark
                        ? "#64748b"
                        : "#94a3b8",
                }}
              >
                {s.label}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── code blocks ──────────────────────────────────────────── */

const DEFINE = `import { createWizardFactory } from '@wizard/core';

const factory = createWizardFactory<{
  userId?: string;
}>();

const steps = factory.defineSteps({
  info:    factory.step({ data: { name: '' },  next: ['plan'] }),
  plan:    factory.step({ data: { tier: '' },  next: ['pay'] }),
  pay:     factory.step({ data: { card: '' },  next: ['done'] }),
  done:    factory.step({ data: { ok: false }, next: [] }),
});

export const wizard = factory.createWizard(steps, {
  context: {},
});`;

const REACT = `import { useWizard } from '@wizard/react';
import { wizard } from './wizard';

function Signup() {
  const { step, data, goTo, helpers } = useWizard(wizard);
  const { percent } = helpers.progress();

  return (
    <div>
      <ProgressBar value={percent} />
      <h2>Step: {step}</h2>

      {step === 'info' && (
        <InfoForm
          value={data.name}
          onNext={() => goTo('plan')}
        />
      )}
      {step === 'pay' && (
        <PayForm
          onBack={() => goTo('plan')}
          onNext={() => goTo('done')}
        />
      )}
    </div>
  );
}`;

/* ── main component ───────────────────────────────────────── */

export function Landing() {
  const isDark = useDarkMode();

  const bg = isDark ? "bg-[#0c0c0e]" : "bg-white";
  const mutedText = isDark ? "text-gray-500" : "text-gray-400";
  const bodyText = isDark ? "text-gray-400" : "text-gray-600";
  const headingText = isDark ? "text-gray-100" : "text-gray-900";
  const cardBg = isDark
    ? "bg-gray-900/60 border-gray-800/60"
    : "bg-gray-50/80 border-gray-200";
  const codeBg = isDark ? "bg-[#0a0a0b]" : "bg-[#fafafa]";
  const codeBorder = isDark ? "border-gray-800/80" : "border-gray-200";

  return (
    <div className={`min-h-screen ${bg}`}>
      {/* ── hero ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* subtle radial glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: isDark
              ? "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(59,130,246,0.08) 0%, transparent 70%)"
              : "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(59,130,246,0.04) 0%, transparent 70%)",
          }}
        />

        <div className="relative max-w-5xl mx-auto px-6 pt-24 pb-20">
          {/* eyebrow */}
          <div
            className={`flex items-center justify-center gap-2 mb-6 text-xs font-medium tracking-wide uppercase ${mutedText}`}
          >
            <span className="inline-block w-4 h-px bg-blue-500/50" />
            open-source typescript library
            <span className="inline-block w-4 h-px bg-blue-500/50" />
          </div>

          <h1
            className={`text-center text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1] mb-5 ${headingText}`}
          >
            Multi-step flows,
            <br />
            <span className="bg-gradient-to-r from-blue-500 via-violet-500 to-blue-500 bg-clip-text text-transparent">
              fully type-safe
            </span>
          </h1>

          <p
            className={`text-center text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed ${bodyText}`}
          >
            Wizard gives you a headless engine for multi-step wizards with
            complete TypeScript inference &mdash; step data, transitions,
            guards, and validation.&nbsp;Zero runtime UI&nbsp;lock&#8209;in.
          </p>

          {/* step flow animation */}
          <div className="flex justify-center mb-12">
            <div
              className={`inline-flex rounded-xl border px-8 py-5 ${cardBg}`}
            >
              <StepFlow />
            </div>
          </div>

          {/* CTA row */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/getting-started"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors no-underline"
            >
              Get Started
            </Link>
            <Link
              href="/examples"
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors no-underline ${
                isDark
                  ? "border-gray-700 text-gray-300 hover:border-gray-600 hover:bg-white/[0.03]"
                  : "border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
              }`}
            >
              Examples
            </Link>
            <Link
              href="/api-docs"
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors no-underline ${
                isDark
                  ? "text-gray-500 hover:text-gray-300"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              API Docs &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* ── install ───────────────────────────────────────── */}
      <section className="max-w-xl mx-auto px-6 pb-20">
        <div
          className={`flex items-center rounded-lg overflow-hidden border ${codeBorder}`}
        >
          <div
            className={`flex-1 flex items-center gap-2 px-4 py-3 font-mono text-sm ${codeBg}`}
          >
            <span className={mutedText}>$</span>
            <code className={isDark ? "text-gray-300" : "text-gray-700"}>
              npm i @wizard/core @wizard/react
            </code>
          </div>
          <div className={`px-3 border-l ${codeBorder}`}>
            <CopyButton text="npm i @wizard/core @wizard/react" />
          </div>
        </div>
      </section>

      {/* ── two-column code ───────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="grid lg:grid-cols-2 gap-5">
          {/* define */}
          <div>
            <div
              className={`flex items-center gap-2 mb-3 text-xs font-semibold tracking-wide uppercase ${mutedText}`}
            >
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Define
            </div>
            <div className={`rounded-xl overflow-hidden border ${codeBorder}`}>
              <div
                className={`flex items-center justify-between px-4 py-2 text-xs ${
                  isDark
                    ? "bg-gray-900/80 text-gray-500"
                    : "bg-gray-100/80 text-gray-400"
                }`}
              >
                <span className="font-mono">wizard.ts</span>
                <CopyButton text={DEFINE} />
              </div>
              <pre
                className={`m-0 px-4 py-4 text-[12.5px] leading-[1.65] font-mono overflow-x-auto ${
                  isDark
                    ? "bg-[#09090b] text-gray-400"
                    : "bg-[#fafafa] text-gray-600"
                }`}
              >
                <code>{DEFINE}</code>
              </pre>
            </div>
          </div>

          {/* consume */}
          <div>
            <div
              className={`flex items-center gap-2 mb-3 text-xs font-semibold tracking-wide uppercase ${mutedText}`}
            >
              <span className="w-2 h-2 rounded-full bg-violet-500" />
              Consume
            </div>
            <div className={`rounded-xl overflow-hidden border ${codeBorder}`}>
              <div
                className={`flex items-center justify-between px-4 py-2 text-xs ${
                  isDark
                    ? "bg-gray-900/80 text-gray-500"
                    : "bg-gray-100/80 text-gray-400"
                }`}
              >
                <span className="font-mono">Signup.tsx</span>
                <CopyButton text={REACT} />
              </div>
              <pre
                className={`m-0 px-4 py-4 text-[12.5px] leading-[1.65] font-mono overflow-x-auto ${
                  isDark
                    ? "bg-[#09090b] text-gray-400"
                    : "bg-[#fafafa] text-gray-600"
                }`}
              >
                <code>{REACT}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── capabilities strip ────────────────────────────── */}
      <section className={`border-y ${codeBorder}`}>
        <div className="max-w-6xl mx-auto px-6 py-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            {
              label: "Type-Safe Transitions",
              detail:
                "goTo() only accepts steps declared in next[]. Impossible illegal transitions at compile time.",
            },
            {
              label: "Headless Engine",
              detail:
                "Pure state machine with zero DOM. Render with React, Vue, Svelte, or a CLI.",
            },
            {
              label: "Weighted Progress",
              detail:
                "progress() accounts for step weight, optional steps, and completion status.",
            },
            {
              label: "DAG Prerequisites",
              detail:
                "Define step dependencies as a graph. Topological sort handles ordering automatically.",
            },
          ].map((cap) => (
            <div key={cap.label}>
              <h3 className={`text-[15px] font-semibold mb-1.5 ${headingText}`}>
                {cap.label}
              </h3>
              <p className={`text-[13px] leading-relaxed m-0 ${bodyText}`}>
                {cap.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── footer ────────────────────────────────────────── */}
      <footer className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className={`text-[13px] ${mutedText}`}>
          {new Date().getFullYear()} &copy; Wizard
        </span>
        <div className={`flex gap-5 text-[13px] ${mutedText}`}>
          <Link
            href="/getting-started"
            className={`no-underline hover:${headingText} transition-colors ${mutedText}`}
          >
            Docs
          </Link>
          <Link
            href="/api-docs"
            className={`no-underline hover:${headingText} transition-colors ${mutedText}`}
          >
            API
          </Link>
          <Link
            href="/examples"
            className={`no-underline hover:${headingText} transition-colors ${mutedText}`}
          >
            Examples
          </Link>
        </div>
      </footer>
    </div>
  );
}
