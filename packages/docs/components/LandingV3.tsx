import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useDarkMode } from "./hooks/useDarkMode";

/**
 * V3: PRISM — Iridescent light refraction
 *
 * Clean white base with prismatic gradient accents.
 * Sora font. Animated gradient borders. Rainbow shimmer.
 * Airy, modern, premium. Code on frosted glass cards
 * with gradient left-edge accents.
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

const RAINBOW =
  "linear-gradient(135deg, #f43f5e, #ec4899, #a855f7, #6366f1, #3b82f6, #06b6d4, #10b981, #84cc16, #eab308, #f43f5e)";

function StepBeam({ isDark }: { isDark: boolean }) {
  const [active, setActive] = useState(0);
  const steps = ["info", "plan", "pay", "done"];
  const colors = ["#f43f5e", "#a855f7", "#3b82f6", "#10b981"];

  useEffect(() => {
    const id = setInterval(() => setActive((i) => (i + 1) % 4), 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-0 w-full max-w-xs mx-auto">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && (
            <div
              className="flex-1 h-[2px] transition-all duration-700"
              style={{
                background:
                  i <= active
                    ? `linear-gradient(90deg, ${colors[i - 1]}, ${colors[i]})`
                    : isDark
                      ? "#2a2a3a"
                      : "#e2e2ea",
              }}
            />
          )}
          <div className="relative flex flex-col items-center">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500"
              style={{
                background:
                  i === active
                    ? colors[i]
                    : i < active
                      ? `${colors[i]}22`
                      : isDark
                        ? "#18182a"
                        : "#f0f0f5",
                color:
                  i === active
                    ? "#fff"
                    : i < active
                      ? colors[i]
                      : isDark
                        ? "#555"
                        : "#aaa",
                boxShadow: i === active ? `0 0 20px ${colors[i]}55` : "none",
                transform: i === active ? "scale(1.15)" : "scale(1)",
              }}
            >
              {i < active ? "✓" : i + 1}
            </div>
            <span
              className="text-[9px] mt-1 font-medium"
              style={{
                color: i <= active ? colors[i] : isDark ? "#444" : "#bbb",
              }}
            >
              {s}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function LandingV3() {
  const isDark = useDarkMode();
  const [copied, setCopied] = useState(false);

  const bg = isDark ? "#0b0b14" : "#fcfcfe";
  const fg = isDark ? "#e4e4f0" : "#1a1a2e";
  const muted = isDark ? "#555566" : "#9999aa";
  const cardBg = isDark ? "rgba(20,20,35,0.8)" : "rgba(255,255,255,0.8)";
  const cardBorder = isDark ? "rgba(60,60,80,0.3)" : "rgba(200,200,220,0.5)";
  const codeFg = isDark ? "#c8c8d8" : "#2a2a3e";
  const font = "'Sora', system-ui, -apple-system, sans-serif";
  const mono = "'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
        .prism-shimmer {
          background: ${RAINBOW};
          background-size: 400% 400%;
          animation: shimmer 8s linear infinite;
        }
        @keyframes shimmer { 0% { background-position: 0% 50%; } 100% { background-position: 400% 50%; } }
        .prism-glow {
          background: ${RAINBOW};
          background-size: 200% 200%;
          animation: shimmer 6s linear infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .prism-card {
          position: relative;
          border-radius: 16px;
          overflow: hidden;
        }
        .prism-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; width: 3px; height: 100%;
          background: ${RAINBOW};
          background-size: 100% 600%;
          animation: shimmer-v 4s linear infinite;
        }
        @keyframes shimmer-v { 0% { background-position: 50% 0%; } 100% { background-position: 50% 600%; } }
      `}</style>

      <div
        className="min-h-screen"
        style={{ background: bg, fontFamily: font }}
      >
        {/* prismatic top line */}
        <div className="h-[2px] prism-shimmer" />

        <div className="max-w-5xl mx-auto px-6 sm:px-8">
          {/* hero */}
          <div className="text-center pt-20 sm:pt-28 pb-16">
            <div
              className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 text-[11px] font-medium tracking-wider uppercase"
              style={{
                color: muted,
                border: `1px solid ${cardBorder}`,
                borderRadius: "100px",
              }}
            >
              <div className="w-1 h-1 rounded-full prism-shimmer" />
              Open-source TypeScript
            </div>

            <h1
              className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.08] mb-6"
              style={{ color: fg }}
            >
              Multi-step flows,
              <br />
              <span className="prism-glow">fully type-safe</span>
            </h1>

            <p
              className="text-[17px] sm:text-lg leading-relaxed max-w-lg mx-auto mb-12"
              style={{ color: muted, fontWeight: 300 }}
            >
              Headless wizard engine with complete TypeScript inference. Step
              data, transitions, guards &mdash; zero UI lock-in.
            </p>

            <StepBeam isDark={isDark} />
          </div>

          {/* cta + install */}
          <div className="flex flex-col items-center gap-4 mb-16">
            <div className="flex items-center gap-3">
              <Link
                href="/getting-started"
                className="no-underline px-6 py-2.5 text-[13px] font-semibold text-white transition-transform hover:scale-[1.03]"
                style={{
                  fontFamily: font,
                  background: "linear-gradient(135deg, #6366f1, #a855f7)",
                  borderRadius: "10px",
                  boxShadow: "0 4px 16px rgba(99,102,241,0.25)",
                }}
              >
                Get Started
              </Link>
              <Link
                href="/examples"
                className="no-underline px-5 py-2.5 text-[13px] font-medium transition-colors"
                style={{
                  fontFamily: font,
                  color: muted,
                  border: `1px solid ${cardBorder}`,
                  borderRadius: "10px",
                }}
              >
                Examples
              </Link>
            </div>
            <div
              className="flex items-center gap-2 px-4 py-2 mt-2"
              style={{
                background: isDark ? "rgba(20,20,35,0.5)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${cardBorder}`,
                borderRadius: "8px",
              }}
            >
              <code
                className="text-[13px]"
                style={{ fontFamily: mono, color: codeFg }}
              >
                <span style={{ color: muted }}>$</span> npm i @wizard/core
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
                className="ml-2 text-[10px] font-medium px-2 py-0.5 border-none cursor-pointer transition-colors"
                style={{
                  fontFamily: font,
                  background: copied ? "rgba(16,185,129,0.15)" : "transparent",
                  color: copied ? "#10b981" : muted,
                  borderRadius: "4px",
                }}
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>
          </div>

          {/* code cards */}
          <div className="grid lg:grid-cols-2 gap-4 mb-20">
            {[
              { label: "Define", file: "wizard.ts", code: DEFINE },
              { label: "Consume", file: "Signup.tsx", code: CONSUME },
            ].map((block) => (
              <div
                key={block.label}
                className="prism-card"
                style={{
                  background: cardBg,
                  border: `1px solid ${cardBorder}`,
                }}
              >
                <div
                  className="flex items-center justify-between px-5 py-3"
                  style={{ borderBottom: `1px solid ${cardBorder}` }}
                >
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: muted, paddingLeft: 8 }}
                  >
                    {block.label}
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ fontFamily: mono, color: muted }}
                  >
                    {block.file}
                  </span>
                </div>
                <pre
                  className="m-0 px-5 py-4 text-[12px] leading-[1.7] overflow-x-auto"
                  style={{
                    fontFamily: mono,
                    color: codeFg,
                    paddingLeft: 20,
                  }}
                >
                  {block.code}
                </pre>
              </div>
            ))}
          </div>

          {/* features */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-20">
            {[
              {
                title: "Type-Safe",
                desc: "Compile-time step validation. goTo() rejects impossible transitions.",
                color: "#f43f5e",
              },
              {
                title: "Headless",
                desc: "Pure state machine. Zero DOM. Any renderer.",
                color: "#a855f7",
              },
              {
                title: "Progress",
                desc: "Weighted, honest completion tracking.",
                color: "#3b82f6",
              },
              {
                title: "DAG Deps",
                desc: "Topological ordering of step prerequisites.",
                color: "#10b981",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="p-4"
                style={{
                  borderRadius: "12px",
                  border: `1px solid ${cardBorder}`,
                  background: cardBg,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: f.color,
                      boxShadow: `0 0 8px ${f.color}44`,
                    }}
                  />
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: fg }}
                  >
                    {f.title}
                  </span>
                </div>
                <p
                  className="text-[12px] leading-relaxed m-0"
                  style={{ color: muted }}
                >
                  {f.desc}
                </p>
              </div>
            ))}
          </div>

          {/* footer */}
          <div className="h-[2px] prism-shimmer mb-6" />
          <footer
            className="flex items-center justify-between pb-8 text-[11px]"
            style={{ color: muted }}
          >
            <span>{new Date().getFullYear()} &copy; Wizard</span>
            <div className="flex gap-4">
              <Link
                href="/getting-started"
                className="no-underline transition-colors"
                style={{ fontFamily: font, color: muted }}
              >
                Docs
              </Link>
              <Link
                href="/api-docs"
                className="no-underline transition-colors"
                style={{ fontFamily: font, color: muted }}
              >
                API
              </Link>
              <Link
                href="/examples"
                className="no-underline transition-colors"
                style={{ fontFamily: font, color: muted }}
              >
                Examples
              </Link>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
