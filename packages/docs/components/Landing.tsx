import React, { useState } from "react";
import Link from "next/link";

import { useDarkMode } from "./hooks/useDarkMode";

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

export function Landing() {
  const isDark = useDarkMode();

  const bg = isDark ? "#0a0a0a" : "#fff";
  const fg = isDark ? "#e5e5e5" : "#0a0a0a";
  const dim = isDark ? "#555" : "#999";
  const faint = isDark ? "#333" : "#e5e5e5";
  const codeBg = isDark ? "#111" : "#fafafa";
  const codeFg = isDark ? "#aaa" : "#555";
  const mono = "'JetBrains Mono', 'SF Mono', ui-monospace, Consolas, monospace";

  return (
    <div style={{ background: bg, minHeight: "100vh" }}>
      {/* hero */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ paddingTop: 100, paddingBottom: 64 }}>
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
  );
}
