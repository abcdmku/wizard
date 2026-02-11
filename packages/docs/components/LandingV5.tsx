import React, { useState, useEffect } from "react";
import Link from "next/link";

/**
 * V5: NOIR — Dark command center / HUD dashboard
 *
 * Very dark background. Dense CSS grid bento layout.
 * Neon green status indicators. Terminal-style code panels.
 * JetBrains Mono font. Always-dark. Information-dense.
 * Each piece of content lives in its own bordered panel.
 */

const BG = "#08080c";
const PANEL = "#0c0c12";
const BORDER = "#1a1a28";
const NEON = "#00e87b";
const CYAN = "#00b4d8";
const AMBER = "#f59e0b";
const FG = "#c8c8d8";
const DIM = "#44445a";

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

function Panel({
  children,
  className = "",
  title,
  badge,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  badge?: { label: string; color: string };
}) {
  return (
    <div
      className={className}
      style={{
        background: PANEL,
        border: `1px solid ${BORDER}`,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {title && (
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: DIM,
            }}
          >
            {title}
          </span>
          {badge && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 3,
                background: `${badge.color}18`,
                color: badge.color,
                letterSpacing: "0.05em",
              }}
            >
              {badge.label}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}66`,
        animation: pulse ? "pulse-glow 2s ease-in-out infinite" : undefined,
      }}
    />
  );
}

function MiniFlow() {
  const [active, setActive] = useState(0);
  const steps = ["info", "plan", "pay", "done"];
  const colors = [CYAN, "#a855f7", AMBER, NEON];

  useEffect(() => {
    const id = setInterval(() => setActive((i) => (i + 1) % 4), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-1 px-3 py-3">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && (
            <div
              style={{
                flex: 1,
                height: 1,
                background: i <= active ? colors[i] : BORDER,
                transition: "background 0.5s",
              }}
            />
          )}
          <div className="flex flex-col items-center gap-1">
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
                transition: "all 0.4s",
                background:
                  i === active
                    ? colors[i]
                    : i < active
                      ? `${colors[i]}20`
                      : "#12121e",
                color: i === active ? "#000" : i < active ? colors[i] : DIM,
                boxShadow: i === active ? `0 0 12px ${colors[i]}44` : "none",
              }}
            >
              {i < active ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: 8, color: i <= active ? colors[i] : DIM }}>
              {s}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function LandingV5() {
  const [copied, setCopied] = useState(false);
  const mono = "'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .noir-link { color: ${CYAN}; text-decoration: none; transition: color 0.2s; font-size: 11px; }
        .noir-link:hover { color: ${FG}; }
      `}</style>

      <div
        className="min-h-screen"
        style={{ background: BG, fontFamily: mono, color: FG }}
      >
        {/* status bar */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div className="flex items-center gap-3">
            <StatusDot color={NEON} pulse />
            <span style={{ fontSize: 11, fontWeight: 600, color: FG }}>
              WIZARD
            </span>
            <span style={{ fontSize: 9, color: DIM }}>v1.0.0</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/getting-started"
              className="noir-link"
              style={{ fontFamily: mono }}
            >
              docs
            </Link>
            <Link
              href="/examples"
              className="noir-link"
              style={{ fontFamily: mono }}
            >
              examples
            </Link>
            <Link
              href="/api-docs"
              className="noir-link"
              style={{ fontFamily: mono }}
            >
              api
            </Link>
          </div>
        </div>

        {/* main grid */}
        <div className="max-w-6xl mx-auto p-3 sm:p-4">
          <div className="grid grid-cols-4 lg:grid-cols-8 gap-3 auto-rows-min">
            {/* hero panel — spans 4 cols, 2 rows on lg */}
            <Panel
              className="col-span-4 lg:row-span-2"
              title="system"
              badge={{ label: "ACTIVE", color: NEON }}
            >
              <div className="px-4 py-5">
                <h1
                  style={{
                    fontSize: "clamp(24px, 4vw, 40px)",
                    fontWeight: 700,
                    lineHeight: 1.15,
                    margin: "0 0 12px",
                    color: "#fff",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Type-safe
                  <br />
                  multi-step flows
                </h1>
                <p
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: DIM,
                    margin: "0 0 20px",
                    maxWidth: 380,
                  }}
                >
                  Headless wizard engine. Complete TypeScript inference. Step
                  data, transitions, guards. Zero UI lock-in.
                </p>
                <div className="flex items-center gap-3">
                  <Link
                    href="/getting-started"
                    className="no-underline px-4 py-2 text-[11px] font-bold uppercase tracking-wider"
                    style={{
                      fontFamily: mono,
                      background: NEON,
                      color: "#000",
                      borderRadius: 4,
                    }}
                  >
                    Get Started
                  </Link>
                  <Link
                    href="/examples"
                    className="no-underline px-4 py-2 text-[11px] font-bold uppercase tracking-wider"
                    style={{
                      fontFamily: mono,
                      color: DIM,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 4,
                    }}
                  >
                    Examples
                  </Link>
                </div>
              </div>
            </Panel>

            {/* install panel */}
            <Panel className="col-span-4" title="install">
              <div className="flex items-center gap-2 px-3 py-3">
                <span style={{ color: AMBER, fontSize: 12 }}>$</span>
                <code style={{ fontSize: 12, color: FG, flex: 1 }}>
                  npm i @wizard/core @wizard/react
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      "npm i @wizard/core @wizard/react",
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 border-none cursor-pointer"
                  style={{
                    fontFamily: mono,
                    background: copied ? `${NEON}18` : "transparent",
                    color: copied ? NEON : DIM,
                    borderRadius: 3,
                  }}
                >
                  {copied ? "copied" : "copy"}
                </button>
              </div>
            </Panel>

            {/* flow preview panel */}
            <Panel
              className="col-span-4"
              title="flow"
              badge={{ label: "LIVE", color: AMBER }}
            >
              <MiniFlow />
            </Panel>

            {/* define code panel — large */}
            <Panel
              className="col-span-4 lg:row-span-2"
              title="define"
              badge={{ label: "wizard.ts", color: CYAN }}
            >
              <pre
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  lineHeight: 1.65,
                  margin: 0,
                  padding: "12px 14px",
                  color: FG,
                  overflowX: "auto",
                }}
              >
                {DEFINE}
              </pre>
            </Panel>

            {/* consume code panel — large */}
            <Panel
              className="col-span-4 lg:row-span-2"
              title="consume"
              badge={{ label: "Signup.tsx", color: "#a855f7" }}
            >
              <pre
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  lineHeight: 1.65,
                  margin: 0,
                  padding: "12px 14px",
                  color: FG,
                  overflowX: "auto",
                }}
              >
                {CONSUME}
              </pre>
            </Panel>

            {/* feature panels — 4 small */}
            {[
              {
                title: "type-safe",
                desc: "Compile-time step validation via goTo()",
                color: NEON,
                status: "enforced",
              },
              {
                title: "headless",
                desc: "Zero DOM. Any renderer.",
                color: CYAN,
                status: "active",
              },
              {
                title: "progress",
                desc: "Weighted completion tracking",
                color: AMBER,
                status: "tracking",
              },
              {
                title: "dag deps",
                desc: "Topological step ordering",
                color: "#a855f7",
                status: "resolved",
              },
            ].map((f) => (
              <Panel
                key={f.title}
                className="col-span-2"
                title={f.title}
                badge={{ label: f.status, color: f.color }}
              >
                <div className="px-3 py-3 flex items-start gap-2">
                  <StatusDot color={f.color} />
                  <span style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                    {f.desc}
                  </span>
                </div>
              </Panel>
            ))}
          </div>
        </div>

        {/* footer */}
        <div
          className="flex items-center justify-center py-4"
          style={{ borderTop: `1px solid ${BORDER}` }}
        >
          <span style={{ fontSize: 10, color: DIM }}>
            {new Date().getFullYear()} &copy; wizard &middot; MIT
          </span>
        </div>
      </div>
    </>
  );
}
