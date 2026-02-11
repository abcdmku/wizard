import React, { useState } from "react";
import Link from "next/link";
import { useDarkMode } from "./hooks/useDarkMode";

/**
 * V2: BROADSHEET — Newspaper editorial typography
 *
 * Instrument Serif massive headlines. Strict left alignment.
 * Black/white + single red accent. No border-radius anywhere.
 * Strong horizontal rules. Numbered features. Print aesthetic.
 */

const DEFINE = `import { createWizardFactory } from '@wizard/core';

const factory = createWizardFactory<{
  userId?: string;
}>();

const steps = factory.defineSteps({
  info: factory.step({ data: { name: '' }, next: ['plan'] }),
  plan: factory.step({ data: { tier: '' }, next: ['pay'] }),
  pay:  factory.step({ data: { card: '' }, next: ['done'] }),
  done: factory.step({ data: { ok: false }, next: [] }),
});

export const wizard = factory.createWizard(steps, {
  context: {},
});`;

const CONSUME = `import { useWizard } from '@wizard/react';
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
    </div>
  );
}`;

function Rule({ color }: { color: string }) {
  return (
    <hr style={{ border: "none", height: 1, background: color, margin: 0 }} />
  );
}

function ThickRule({ color }: { color: string }) {
  return (
    <hr style={{ border: "none", height: 3, background: color, margin: 0 }} />
  );
}

export function LandingV2() {
  const isDark = useDarkMode();
  const [copied, setCopied] = useState(false);

  const bg = isDark ? "#0a0a0a" : "#faf8f5";
  const fg = isDark ? "#e8e4de" : "#1a1a1a";
  const muted = isDark ? "#5a5550" : "#a09890";
  const rule = isDark ? "#2a2520" : "#d8d0c8";
  const red = "#c41e1e";
  const codeBg = isDark ? "#0e0e0c" : "#f2efe8";
  const serif = "'Instrument Serif', 'Georgia', 'Times New Roman', serif";
  const sans = "'Helvetica Neue', 'Arial', system-ui, sans-serif";
  const mono = "'IBM Plex Mono', ui-monospace, 'SF Mono', Consolas, monospace";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
      `}</style>

      <div className="min-h-screen" style={{ background: bg, color: fg }}>
        <div className="max-w-[860px] mx-auto px-6 sm:px-8">
          {/* masthead */}
          <div
            className="pt-10 pb-4"
            style={{ borderBottom: `3px double ${rule}` }}
          >
            <div className="flex items-baseline justify-between">
              <span
                style={{
                  fontFamily: serif,
                  fontSize: 18,
                  fontStyle: "italic",
                  color: muted,
                }}
              >
                Wizard
              </span>
              <span
                style={{
                  fontFamily: sans,
                  fontSize: 10,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: muted,
                }}
              >
                Open Source &middot; TypeScript &middot; MIT
              </span>
            </div>
          </div>

          {/* headline */}
          <div className="pt-12 pb-8">
            <h1
              style={{
                fontFamily: serif,
                fontSize: "clamp(56px, 10vw, 108px)",
                lineHeight: 0.92,
                fontWeight: 400,
                letterSpacing: "-0.02em",
                margin: 0,
                color: fg,
              }}
            >
              Multi-step
              <br />
              flows, fully
              <br />
              <em style={{ fontStyle: "italic", color: red }}>type-safe</em>
            </h1>
          </div>

          <ThickRule color={isDark ? "#333" : "#1a1a1a"} />

          {/* sub-headline row */}
          <div className="grid sm:grid-cols-3 gap-6 py-8">
            <div className="sm:col-span-2">
              <p
                style={{
                  fontFamily: serif,
                  fontSize: 20,
                  lineHeight: 1.6,
                  margin: 0,
                  color: isDark ? "#b0a89e" : "#444",
                }}
              >
                A headless engine for multi-step wizards with complete
                TypeScript inference&thinsp;&mdash;&thinsp;step data,
                transitions, guards, and validation. Zero runtime UI lock-in.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:items-end sm:justify-end">
              <Link
                href="/getting-started"
                className="no-underline block text-center px-5 py-2.5 text-[13px] font-medium transition-colors"
                style={{
                  fontFamily: sans,
                  background: red,
                  color: "#fff",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Read the Docs
              </Link>
              <div className="flex gap-4">
                <Link
                  href="/examples"
                  className="no-underline text-[12px] uppercase tracking-wider"
                  style={{ fontFamily: sans, color: muted }}
                >
                  Examples
                </Link>
                <Link
                  href="/api-docs"
                  className="no-underline text-[12px] uppercase tracking-wider"
                  style={{ fontFamily: sans, color: muted }}
                >
                  API
                </Link>
              </div>
            </div>
          </div>

          <Rule color={rule} />

          {/* install */}
          <div className="py-5 flex items-center justify-between">
            <code style={{ fontFamily: mono, fontSize: 14, color: fg }}>
              <span style={{ color: red }}>$</span> npm i @wizard/core
              @wizard/react
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  "npm i @wizard/core @wizard/react",
                );
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="border-none cursor-pointer text-[11px] uppercase tracking-wider font-medium px-3 py-1 transition-colors"
              style={{
                fontFamily: sans,
                background: "transparent",
                color: copied ? red : muted,
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <Rule color={rule} />

          {/* code figures */}
          <div className="grid md:grid-cols-2 gap-0">
            {/* fig 1 */}
            <div
              className="py-8 md:pr-8"
              style={{ borderRight: `1px solid ${rule}` }}
            >
              <div className="flex items-baseline gap-3 mb-4">
                <span
                  style={{
                    fontFamily: serif,
                    fontStyle: "italic",
                    fontSize: 14,
                    color: muted,
                  }}
                >
                  Fig. 1
                </span>
                <span
                  style={{
                    fontFamily: sans,
                    fontSize: 10,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    color: muted,
                  }}
                >
                  Definition
                </span>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    color: muted,
                    marginLeft: "auto",
                  }}
                >
                  wizard.ts
                </span>
              </div>
              <pre
                style={{
                  fontFamily: mono,
                  fontSize: 11.5,
                  lineHeight: 1.7,
                  margin: 0,
                  padding: "16px",
                  background: codeBg,
                  color: isDark ? "#c8c0b8" : "#333",
                  overflowX: "auto",
                  border: `1px solid ${rule}`,
                }}
              >
                {DEFINE}
              </pre>
            </div>

            {/* fig 2 */}
            <div className="py-8 md:pl-8">
              <div className="flex items-baseline gap-3 mb-4">
                <span
                  style={{
                    fontFamily: serif,
                    fontStyle: "italic",
                    fontSize: 14,
                    color: muted,
                  }}
                >
                  Fig. 2
                </span>
                <span
                  style={{
                    fontFamily: sans,
                    fontSize: 10,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    color: muted,
                  }}
                >
                  Consumption
                </span>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    color: muted,
                    marginLeft: "auto",
                  }}
                >
                  Signup.tsx
                </span>
              </div>
              <pre
                style={{
                  fontFamily: mono,
                  fontSize: 11.5,
                  lineHeight: 1.7,
                  margin: 0,
                  padding: "16px",
                  background: codeBg,
                  color: isDark ? "#c8c0b8" : "#333",
                  overflowX: "auto",
                  border: `1px solid ${rule}`,
                }}
              >
                {CONSUME}
              </pre>
            </div>
          </div>

          <ThickRule color={isDark ? "#333" : "#1a1a1a"} />

          {/* numbered features */}
          <div className="py-10 grid sm:grid-cols-2 gap-x-12 gap-y-8">
            {[
              {
                n: "01",
                title: "Type-Safe Transitions",
                body: "goTo() only accepts steps declared in your next[] array. Impossible transitions caught at compile time.",
              },
              {
                n: "02",
                title: "Headless Engine",
                body: "Pure state machine, zero DOM coupling. Render with React, Vue, Svelte, or a CLI.",
              },
              {
                n: "03",
                title: "Weighted Progress",
                body: "progress() accounts for step weight, optional steps, and completion status.",
              },
              {
                n: "04",
                title: "DAG Prerequisites",
                body: "Step dependencies form a directed graph. Topological sort handles ordering.",
              },
            ].map((f) => (
              <div key={f.n}>
                <div className="flex items-baseline gap-3 mb-2">
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 11,
                      color: red,
                      fontWeight: 500,
                    }}
                  >
                    {f.n}
                  </span>
                  <h3
                    style={{
                      fontFamily: sans,
                      fontSize: 14,
                      fontWeight: 600,
                      margin: 0,
                      color: fg,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {f.title}
                  </h3>
                </div>
                <p
                  style={{
                    fontFamily: serif,
                    fontSize: 15,
                    lineHeight: 1.65,
                    margin: 0,
                    color: isDark ? "#908880" : "#666",
                  }}
                >
                  {f.body}
                </p>
              </div>
            ))}
          </div>

          <Rule color={rule} />

          {/* colophon */}
          <div
            className="py-8 flex items-center justify-between text-[10px] uppercase tracking-[0.15em]"
            style={{ fontFamily: sans, color: muted }}
          >
            <span>{new Date().getFullYear()} &copy; Wizard</span>
            <span
              style={{
                fontFamily: serif,
                fontSize: 13,
                fontStyle: "italic",
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              &ldquo;The last wizard library you&rsquo;ll configure.&rdquo;
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
