import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";

/**
 * V1: CATHODE — CRT phosphor terminal
 *
 * Always dark. Scan lines, phosphor green glow, vignette,
 * typing animation. Code IS the design. Monospace everything.
 * One big terminal window floating on black.
 */

const GREEN = "#20c20e";
const GREEN_DIM = "#0a5c0a";
const AMBER = "#e8a317";
const SCREEN = "#020a02";

const DEFINE = `import { createWizardFactory } from '@wizard/core';

const factory = createWizardFactory<{ userId?: string }>();

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
        <InfoForm value={data.name} onNext={() => goTo('plan')} />
      )}
    </div>
  );
}`;

function Typed({ text, delay = 0 }: { text: string; delay?: number }) {
  const [len, setLen] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      started.current = true;
      setLen(1);
    }, delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!started.current || len >= text.length) return;
    const t = setTimeout(() => setLen((l) => l + 1), 22);
    return () => clearTimeout(t);
  }, [len, text.length]);

  return (
    <>
      {text.slice(0, len)}
      {len < text.length && <span className="crt-cursor" />}
    </>
  );
}

export function LandingV1() {
  const [copied, setCopied] = useState(false);

  const copy = (t: string) => {
    navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .crt-font { font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace; }
        .crt-glow { text-shadow: 0 0 4px ${GREEN}66, 0 0 12px ${GREEN}22; }
        .crt-glow-bright { text-shadow: 0 0 6px ${GREEN}aa, 0 0 20px ${GREEN}44, 0 0 40px ${GREEN}18; }
        .crt-cursor {
          display: inline-block; width: 9px; height: 16px; margin-left: 1px;
          background: ${GREEN}; vertical-align: text-bottom;
          animation: crt-blink 1s step-end infinite;
        }
        @keyframes crt-blink { 50% { opacity: 0; } }
        .scanlines {
          background: repeating-linear-gradient(
            0deg, transparent, transparent 1px,
            rgba(0,0,0,0.12) 1px, rgba(0,0,0,0.12) 2px
          );
          pointer-events: none;
        }
        .crt-vignette {
          background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%);
          pointer-events: none;
        }
        .crt-flicker { animation: flicker 0.08s infinite alternate; }
        @keyframes flicker { from { opacity: 0.98; } to { opacity: 1; } }
        .crt-link {
          color: ${AMBER}; text-decoration: none; border-bottom: 1px solid ${AMBER}44;
          transition: border-color 0.2s;
        }
        .crt-link:hover { border-color: ${AMBER}; }
      `}</style>

      <div
        className="min-h-screen flex items-center justify-center p-4 sm:p-8 crt-font"
        style={{ background: "#000" }}
      >
        <div
          className="w-full max-w-[880px] relative"
          style={{ perspective: "1200px" }}
        >
          {/* CRT outer bezel */}
          <div
            style={{
              background:
                "linear-gradient(145deg, #1a1a1a 0%, #0d0d0d 50%, #111 100%)",
              borderRadius: "20px",
              padding: "18px 18px 22px",
              boxShadow:
                "0 0 60px rgba(32,194,14,0.06), 0 20px 60px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            {/* screen */}
            <div
              className="relative overflow-hidden"
              style={{ background: SCREEN, borderRadius: "8px" }}
            >
              {/* scan lines overlay */}
              <div className="absolute inset-0 z-10 scanlines" />
              {/* vignette */}
              <div className="absolute inset-0 z-10 crt-vignette" />

              {/* content */}
              <div
                className="relative z-0 crt-flicker p-6 sm:p-10"
                style={{ minHeight: "520px" }}
              >
                {/* status bar */}
                <div
                  className="flex items-center justify-between mb-8 text-[11px]"
                  style={{ color: GREEN_DIM }}
                >
                  <span>wizard@latest</span>
                  <span>v1.0.0 &middot; MIT</span>
                </div>

                {/* title */}
                <div
                  className="mb-2 text-[11px] tracking-[0.3em] uppercase"
                  style={{ color: GREEN_DIM }}
                >
                  ~/wizard
                </div>
                <h1
                  className="crt-glow-bright text-3xl sm:text-4xl font-semibold leading-tight mb-6"
                  style={{ color: GREEN, margin: 0 }}
                >
                  <Typed text="Type-safe multi-step flows" delay={300} />
                </h1>
                <p
                  className="crt-glow text-sm leading-relaxed mb-8 max-w-xl"
                  style={{ color: `${GREEN}bb` }}
                >
                  A headless wizard engine with complete TypeScript inference.
                  Define once, render anywhere. Zero UI lock-in.
                </p>

                {/* install */}
                <div className="flex items-center gap-3 mb-10">
                  <span style={{ color: AMBER }}>$</span>
                  <span className="crt-glow" style={{ color: GREEN }}>
                    npm i @wizard/core @wizard/react
                  </span>
                  <button
                    onClick={() => copy("npm i @wizard/core @wizard/react")}
                    className="ml-auto text-[11px] px-2 py-1 border-none cursor-pointer crt-font"
                    style={{
                      background: copied ? `${GREEN}22` : "transparent",
                      color: copied ? GREEN : GREEN_DIM,
                      borderRadius: "2px",
                    }}
                  >
                    {copied ? "copied!" : "[copy]"}
                  </button>
                </div>

                {/* separator */}
                <div className="mb-8 text-[11px]" style={{ color: GREEN_DIM }}>
                  {"// "}─{"─".repeat(50)}
                </div>

                {/* two-column code */}
                <div className="grid md:grid-cols-2 gap-6 mb-10">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span style={{ color: AMBER }}>{"▸"}</span>
                      <span
                        className="text-[11px] uppercase tracking-widest font-medium"
                        style={{ color: GREEN }}
                      >
                        define
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: GREEN_DIM }}
                      >
                        wizard.ts
                      </span>
                    </div>
                    <pre
                      className="m-0 text-[11.5px] leading-[1.65] overflow-x-auto crt-glow"
                      style={{ color: `${GREEN}cc` }}
                    >
                      {DEFINE}
                    </pre>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span style={{ color: AMBER }}>{"▸"}</span>
                      <span
                        className="text-[11px] uppercase tracking-widest font-medium"
                        style={{ color: GREEN }}
                      >
                        consume
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: GREEN_DIM }}
                      >
                        Signup.tsx
                      </span>
                    </div>
                    <pre
                      className="m-0 text-[11.5px] leading-[1.65] overflow-x-auto crt-glow"
                      style={{ color: `${GREEN}cc` }}
                    >
                      {CONSUME}
                    </pre>
                  </div>
                </div>

                {/* separator */}
                <div className="mb-6 text-[11px]" style={{ color: GREEN_DIM }}>
                  {"// "}─{"─".repeat(50)}
                </div>

                {/* features */}
                <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 mb-10 text-[12px]">
                  {[
                    "Type-safe transitions — compile-time step validation",
                    "Headless engine — zero DOM, any renderer",
                    "Weighted progress — real completion math",
                    "DAG prerequisites — topological ordering built in",
                  ].map((f, i) => (
                    <div key={i} className="flex items-start gap-2 crt-glow">
                      <span style={{ color: GREEN }}>✓</span>
                      <span style={{ color: `${GREEN}99` }}>{f}</span>
                    </div>
                  ))}
                </div>

                {/* nav */}
                <div className="flex items-center gap-6 text-[12px]">
                  <Link href="/getting-started" className="crt-link crt-font">
                    get-started
                  </Link>
                  <Link href="/examples" className="crt-link crt-font">
                    examples
                  </Link>
                  <Link href="/api-docs" className="crt-link crt-font">
                    api-docs
                  </Link>
                </div>

                {/* prompt */}
                <div className="mt-8 flex items-center gap-2 text-sm">
                  <span style={{ color: AMBER }}>$</span>
                  <span className="crt-cursor" />
                </div>
              </div>
            </div>
          </div>
          {/* CRT power LED */}
          <div className="flex items-center justify-center mt-4 gap-2">
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: GREEN,
                boxShadow: `0 0 6px ${GREEN}88`,
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
