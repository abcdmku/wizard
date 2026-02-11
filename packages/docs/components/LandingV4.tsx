import React, { useState, useEffect } from "react";
import Link from "next/link";

/**
 * V4: BLUEPRINT — Technical schematic drawing
 *
 * Blueprint blue background, white grid overlay, monospace annotations,
 * dimension markers, title block. Code as "specifications."
 * The wizard flow shown as a simple schematic flowchart.
 * Always blueprint-blue regardless of dark mode toggle.
 */

const BLUE = "#1a365d";
const BLUE_LIGHT = "#234e82";
const GRID = "rgba(147,197,253,0.07)";
const GRID_MAJOR = "rgba(147,197,253,0.12)";
const TEXT = "#93c5fd";
const TEXT_BRIGHT = "#dbeafe";
const TEXT_DIM = "#3b6fa0";
const YELLOW = "#fbbf24";
const WHITE = "#ffffff";

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

function FlowDiagram() {
  const [active, setActive] = useState(0);
  const steps = [
    { id: "info", label: "INFO" },
    { id: "plan", label: "PLAN" },
    { id: "pay", label: "PAY" },
    { id: "done", label: "DONE" },
  ];

  useEffect(() => {
    const id = setInterval(() => setActive((i) => (i + 1) % 4), 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center justify-center gap-0 my-8">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <div className="flex flex-col items-center">
            <div
              style={{
                width: 56,
                height: 32,
                border: `1.5px solid ${i <= active ? TEXT_BRIGHT : TEXT_DIM}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                letterSpacing: "0.1em",
                fontWeight: 600,
                color:
                  i === active ? YELLOW : i < active ? TEXT_BRIGHT : TEXT_DIM,
                background:
                  i === active ? "rgba(251,191,36,0.08)" : "transparent",
                transition: "all 0.5s",
              }}
            >
              {s.label}
            </div>
            <div style={{ fontSize: 8, color: TEXT_DIM, marginTop: 4 }}>
              step.{s.id}
            </div>
          </div>
          {i < steps.length - 1 && (
            <svg
              width="32"
              height="12"
              style={{ margin: "0 -1px", marginBottom: 16 }}
            >
              <line
                x1="0"
                y1="6"
                x2="24"
                y2="6"
                stroke={i < active ? TEXT_BRIGHT : TEXT_DIM}
                strokeWidth="1.5"
              />
              <polygon
                points="24,2 32,6 24,10"
                fill={i < active ? TEXT_BRIGHT : TEXT_DIM}
              />
            </svg>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export function LandingV4() {
  const [copied, setCopied] = useState(false);
  const mono = "'IBM Plex Mono', ui-monospace, 'SF Mono', Consolas, monospace";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .bp-grid {
          background-image:
            repeating-linear-gradient(0deg, transparent, transparent 19px, ${GRID} 19px, ${GRID} 20px),
            repeating-linear-gradient(90deg, transparent, transparent 19px, ${GRID} 19px, ${GRID} 20px),
            repeating-linear-gradient(0deg, transparent, transparent 99px, ${GRID_MAJOR} 99px, ${GRID_MAJOR} 100px),
            repeating-linear-gradient(90deg, transparent, transparent 99px, ${GRID_MAJOR} 99px, ${GRID_MAJOR} 100px);
        }
        .bp-annotation { font-family: ${mono}; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: ${TEXT_DIM}; }
        .bp-link { color: ${YELLOW}; text-decoration: none; border-bottom: 1px solid rgba(251,191,36,0.3); transition: border-color 0.2s; }
        .bp-link:hover { border-color: ${YELLOW}; }
      `}</style>

      <div
        className="min-h-screen bp-grid"
        style={{ background: BLUE, fontFamily: mono, color: TEXT }}
      >
        <div className="max-w-5xl mx-auto px-6 sm:px-8">
          {/* title block — top right */}
          <div className="flex justify-end pt-6 mb-12">
            <div
              style={{
                border: `1px solid ${TEXT_DIM}`,
                padding: "8px 16px",
                minWidth: 200,
              }}
            >
              <div
                style={{
                  borderBottom: `1px solid ${TEXT_DIM}`,
                  paddingBottom: 4,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{ fontSize: 14, fontWeight: 600, color: TEXT_BRIGHT }}
                >
                  WIZARD
                </span>
              </div>
              <div className="bp-annotation" style={{ lineHeight: 1.8 }}>
                Project: type-safe flows
                <br />
                Version: 1.0.0
                <br />
                License: MIT
                <br />
                Scale: 1:1
              </div>
            </div>
          </div>

          {/* main title */}
          <div className="mb-4">
            <div className="bp-annotation mb-2">// specification</div>
            <h1
              style={{
                fontSize: "clamp(32px, 6vw, 56px)",
                fontWeight: 600,
                lineHeight: 1.1,
                color: TEXT_BRIGHT,
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              Multi-step flow
              <br />
              engine
            </h1>
            <div className="flex items-center gap-4 mt-4">
              <div style={{ flex: 1, height: 1, background: TEXT_DIM }} />
              <span style={{ fontSize: 10, color: TEXT_DIM }}>
                TYPE-SAFE &middot; HEADLESS &middot; TYPESCRIPT
              </span>
              <div style={{ flex: 1, height: 1, background: TEXT_DIM }} />
            </div>
          </div>

          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: TEXT,
              maxWidth: 520,
              margin: "16px 0 0",
            }}
          >
            Headless wizard engine with complete TypeScript inference. Step
            data, transitions, guards, and validation. Zero runtime UI lock-in.
          </p>

          {/* flow diagram */}
          <div className="my-8">
            <div className="bp-annotation mb-2">
              // flow diagram — animated preview
            </div>
            <div
              style={{ border: `1px solid ${TEXT_DIM}`, padding: "12px 16px" }}
            >
              <FlowDiagram />
            </div>
          </div>

          {/* install */}
          <div
            className="flex items-center gap-3 my-8 py-3 px-4"
            style={{ border: `1px solid ${TEXT_DIM}` }}
          >
            <span className="bp-annotation">install:</span>
            <code style={{ fontSize: 13, color: TEXT_BRIGHT, flex: 1 }}>
              <span style={{ color: YELLOW }}>$</span> npm i @wizard/core
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
              className="border-none cursor-pointer text-[10px] uppercase tracking-wider px-3 py-1"
              style={{
                fontFamily: mono,
                background: copied ? "rgba(251,191,36,0.12)" : "transparent",
                color: copied ? YELLOW : TEXT_DIM,
              }}
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>

          {/* specifications — code */}
          <div className="grid lg:grid-cols-2 gap-4 my-8">
            {[
              { label: "spec a — definition", file: "wizard.ts", code: DEFINE },
              {
                label: "spec b — consumption",
                file: "Signup.tsx",
                code: CONSUME,
              },
            ].map((block) => (
              <div
                key={block.label}
                style={{ border: `1px solid ${TEXT_DIM}` }}
              >
                <div
                  className="flex items-center justify-between px-4 py-2"
                  style={{ borderBottom: `1px solid ${TEXT_DIM}` }}
                >
                  <span className="bp-annotation">{block.label}</span>
                  <span className="bp-annotation">{block.file}</span>
                </div>
                <pre
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    lineHeight: 1.7,
                    margin: 0,
                    padding: "12px 16px",
                    color: TEXT,
                    overflowX: "auto",
                  }}
                >
                  {block.code}
                </pre>
              </div>
            ))}
          </div>

          {/* features — annotation style */}
          <div className="my-12">
            <div className="bp-annotation mb-4">// features index</div>
            <div className="grid sm:grid-cols-2 gap-x-12 gap-y-6">
              {[
                {
                  n: "A",
                  title: "Type-Safe Transitions",
                  note: "goTo() rejects impossible steps at compile time",
                },
                {
                  n: "B",
                  title: "Headless Engine",
                  note: "Zero DOM — plug in React, Vue, Svelte, or CLI",
                },
                {
                  n: "C",
                  title: "Weighted Progress",
                  note: "Real completion math, not step count / total",
                },
                {
                  n: "D",
                  title: "DAG Prerequisites",
                  note: "Topological sort handles step ordering",
                },
              ].map((f) => (
                <div key={f.n} className="flex gap-3">
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: YELLOW,
                      shrink: 0,
                    }}
                  >
                    {f.n}.
                  </span>
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: TEXT_BRIGHT,
                        marginBottom: 2,
                      }}
                    >
                      {f.title}
                    </div>
                    <div
                      style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.5 }}
                    >
                      {f.note}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* navigation */}
          <div
            style={{ borderTop: `1px solid ${TEXT_DIM}` }}
            className="py-6 flex items-center gap-6"
          >
            <Link
              href="/getting-started"
              className="bp-link"
              style={{ fontFamily: mono, fontSize: 12 }}
            >
              get-started →
            </Link>
            <Link
              href="/examples"
              className="bp-link"
              style={{ fontFamily: mono, fontSize: 12 }}
            >
              examples →
            </Link>
            <Link
              href="/api-docs"
              className="bp-link"
              style={{ fontFamily: mono, fontSize: 12 }}
            >
              api-docs →
            </Link>
            <span style={{ marginLeft: "auto", fontSize: 10, color: TEXT_DIM }}>
              {new Date().getFullYear()} &copy; wizard
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
