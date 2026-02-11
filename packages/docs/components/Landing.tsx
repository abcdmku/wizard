import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";

import { useDarkMode } from "./hooks/useDarkMode";

/* ── code snippets ─────────────────────────────────────── */

const DEFINE = `import { createWizardFactory } from '@wizard/core';

const factory = createWizardFactory<{
  userId?: string;
}>();

const steps = factory.defineSteps({
  info:  factory.step({ data: { name: '' },  next: ['plan'] }),
  plan:  factory.step({ data: { tier: '' },  next: ['pay'] }),
  pay:   factory.step({ data: { card: '' },  next: ['done'] }),
  done:  factory.step({ data: { ok: false }, next: [] }),
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
    </div>
  );
}`;

/* ── tiny helpers ──────────────────────────────────────── */

function CopyBtn({ text, isDark }: { text: string; isDark: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="border-none cursor-pointer text-[11px] font-mono px-2 py-0.5 rounded transition-colors"
      style={{
        background: copied
          ? isDark
            ? "rgba(255,255,255,0.08)"
            : "rgba(0,0,0,0.06)"
          : "transparent",
        color: isDark ? "#555" : "#999",
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/* ── live wizard demo ──────────────────────────────────── */

const STEPS = [
  { id: "info", label: "Info", data: 'name: "Ada"', call: "goTo('plan')" },
  { id: "plan", label: "Plan", data: 'tier: "pro"', call: "goTo('pay')" },
  { id: "pay", label: "Pay", data: 'card: "•••4242"', call: "goTo('done')" },
  { id: "done", label: "Done", data: "ok: true", call: null },
] as const;

function LiveDemo({ isDark, mono }: { isDark: boolean; mono: string }) {
  const [active, setActive] = useState(0);
  const dim = isDark ? "#555" : "#999";
  const faint = isDark ? "#333" : "#e5e5e5";
  const accent = isDark ? "#fff" : "#0a0a0a";

  const advance = useCallback(() => {
    setActive((i) => (i + 1) % (STEPS.length + 1));
  }, []);

  useEffect(() => {
    const id = setInterval(advance, 2200);
    return () => clearInterval(id);
  }, [advance]);

  const step = STEPS[active >= STEPS.length ? STEPS.length - 1 : active];
  const percent = Math.min(
    100,
    Math.round(
      ((active >= STEPS.length ? STEPS.length : active) / STEPS.length) * 100,
    ),
  );

  return (
    <div
      style={{
        border: `1px solid ${faint}`,
        borderRadius: 8,
        overflow: "hidden",
        fontFamily: mono,
        fontSize: 12,
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: `1px solid ${faint}`,
          color: dim,
        }}
      >
        <span>live preview</span>
        <span style={{ fontSize: 11 }}>
          step: <span style={{ color: accent }}>{step.id}</span>
          {" · "}
          progress: <span style={{ color: accent }}>{percent}%</span>
        </span>
      </div>

      {/* body */}
      <div
        style={{
          padding: "20px 16px",
          background: isDark ? "#111" : "#fafafa",
        }}
      >
        {/* progress bar */}
        <div
          style={{
            height: 3,
            background: faint,
            borderRadius: 2,
            marginBottom: 20,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              background: accent,
              borderRadius: 2,
              transition: "width 0.6s ease",
            }}
          />
        </div>

        {/* step indicators */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            marginBottom: 20,
          }}
        >
          {STEPS.map((s, i) => {
            const isDone = i < active;
            const isCurrent = i === active && active < STEPS.length;
            return (
              <React.Fragment key={s.id}>
                {i > 0 && (
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: isDone ? accent : faint,
                      transition: "background 0.4s",
                    }}
                  />
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 600,
                      transition: "all 0.4s",
                      border: isCurrent
                        ? `2px solid ${accent}`
                        : isDone
                          ? `2px solid ${accent}`
                          : `1px solid ${faint}`,
                      background: isDone ? accent : "transparent",
                      color: isDone
                        ? isDark
                          ? "#0a0a0a"
                          : "#fff"
                        : isCurrent
                          ? accent
                          : dim,
                    }}
                  >
                    {isDone ? "\u2713" : i + 1}
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      color: isCurrent || isDone ? accent : dim,
                      transition: "color 0.4s",
                    }}
                  >
                    {s.label}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* state readout */}
        <div style={{ color: dim, lineHeight: 1.8 }}>
          <span style={{ color: isDark ? "#666" : "#bbb" }}>{"// "}</span>
          <span>data.{step.data}</span>
          {step.call && active < STEPS.length && (
            <>
              <br />
              <span style={{ color: isDark ? "#666" : "#bbb" }}>{"// "}</span>
              <span style={{ color: accent }}>{step.call}</span>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 14,
                  background: accent,
                  marginLeft: 2,
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                }}
              />
            </>
          )}
          {active >= STEPS.length && (
            <>
              <br />
              <span style={{ color: isDark ? "#666" : "#bbb" }}>{"// "}</span>
              <span style={{ color: isDark ? "#4ade80" : "#16a34a" }}>
                wizard complete
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── main component ────────────────────────────────────── */

export function Landing() {
  const isDark = useDarkMode();
  const { setTheme } = useTheme();

  const bg = isDark ? "#0a0a0a" : "#fff";
  const fg = isDark ? "#e5e5e5" : "#0a0a0a";
  const dim = isDark ? "#555" : "#999";
  const faint = isDark ? "#333" : "#e5e5e5";
  const codeBg = isDark ? "#111" : "#fafafa";
  const codeFg = isDark ? "#aaa" : "#555";
  const mono =
    "'SF Mono', ui-monospace, Consolas, 'Liberation Mono', monospace";

  return (
    <>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>

      <div style={{ background: bg, minHeight: "100vh" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px" }}>
          {/* dark mode toggle */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              paddingTop: 16,
            }}
          >
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label="Toggle dark mode"
              style={{
                background: "none",
                border: `1px solid ${faint}`,
                borderRadius: 6,
                padding: "6px 8px",
                cursor: "pointer",
                color: dim,
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              {isDark ? "\u2600" : "\u263E"}
            </button>
          </div>

          {/* hero */}
          <div style={{ paddingTop: 64, paddingBottom: 56 }}>
            <h1
              style={{
                fontSize: "clamp(40px, 7vw, 72px)",
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.035em",
                color: fg,
                margin: 0,
              }}
            >
              Wizard
            </h1>
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.6,
                color: dim,
                margin: "16px 0 0",
                maxWidth: 480,
              }}
            >
              Type-safe multi-step flows. Headless engine, full TypeScript
              inference, zero UI lock-in.
            </p>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginTop: 32,
              }}
            >
              <Link
                href="/getting-started"
                className="no-underline"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: isDark ? "#0a0a0a" : "#fff",
                  background: isDark ? "#e5e5e5" : "#0a0a0a",
                  padding: "8px 20px",
                  borderRadius: 6,
                }}
              >
                Get Started
              </Link>
              <Link
                href="/examples"
                className="no-underline"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: dim,
                }}
              >
                Examples
              </Link>
            </div>
          </div>

          {/* install */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: mono,
              fontSize: 13,
              color: codeFg,
              padding: "10px 16px",
              border: `1px solid ${faint}`,
              borderRadius: 8,
              marginBottom: 48,
            }}
          >
            <span style={{ color: dim, userSelect: "none" }}>$</span>
            <code style={{ flex: 1 }}>npm i @wizard/core @wizard/react</code>
            <CopyBtn text="npm i @wizard/core @wizard/react" isDark={isDark} />
          </div>

          {/* live demo */}
          <div style={{ marginBottom: 48 }}>
            <LiveDemo isDark={isDark} mono={mono} />
          </div>

          {/* code blocks */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
              gap: 16,
              paddingBottom: 80,
            }}
          >
            {[
              { label: "wizard.ts", code: DEFINE },
              { label: "Signup.tsx", code: REACT },
            ].map((block) => (
              <div
                key={block.label}
                style={{
                  border: `1px solid ${faint}`,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 16px",
                    borderBottom: `1px solid ${faint}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 12,
                      color: dim,
                    }}
                  >
                    {block.label}
                  </span>
                  <CopyBtn text={block.code} isDark={isDark} />
                </div>
                <pre
                  style={{
                    fontFamily: mono,
                    fontSize: 12,
                    lineHeight: 1.7,
                    margin: 0,
                    padding: "16px 16px",
                    background: codeBg,
                    color: codeFg,
                    overflowX: "auto",
                  }}
                >
                  {block.code}
                </pre>
              </div>
            ))}
          </div>

          {/* footer */}
          <div
            style={{
              borderTop: `1px solid ${faint}`,
              padding: "24px 0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 13,
              color: dim,
            }}
          >
            <span>{new Date().getFullYear()} &copy; Wizard</span>
            <div style={{ display: "flex", gap: 20 }}>
              <Link
                href="/getting-started"
                className="no-underline"
                style={{ color: dim }}
              >
                Docs
              </Link>
              <Link
                href="/api-docs"
                className="no-underline"
                style={{ color: dim }}
              >
                API
              </Link>
              <Link
                href="/examples"
                className="no-underline"
                style={{ color: dim }}
              >
                Examples
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
