import React, { useState } from "react";
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
  const { step, data, goTo, next, back, helpers } = useWizard(wizard);
  const { percent } = helpers.progress();

  return (
    <div>
      <ProgressBar value={percent} />
      <h2>Step: {step}</h2>

      {step === 'info' && (
        <InfoForm
          value={data.name}
          onNext={() => next()}
        />
      )}
    </div>
  );
}`;

/* ── helpers ───────────────────────────────────────────── */

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

/* ── simulated wizard state ────────────────────────────── */

type StepId = "info" | "plan" | "pay" | "done";

interface WizardState {
  step: StepId;
  data: Record<StepId, Record<string, unknown>>;
  history: StepId[];
}

const STEP_CONFIG: Record<
  StepId,
  { next: StepId[]; dataKey: string; defaultData: Record<string, unknown> }
> = {
  info: { next: ["plan"], dataKey: "name", defaultData: { name: "" } },
  plan: { next: ["pay"], dataKey: "tier", defaultData: { tier: "" } },
  pay: { next: ["done"], dataKey: "card", defaultData: { card: "" } },
  done: { next: [], dataKey: "ok", defaultData: { ok: false } },
};

const STEP_ORDER: StepId[] = ["info", "plan", "pay", "done"];

function initialState(): WizardState {
  return {
    step: "info",
    data: {
      info: { name: "" },
      plan: { tier: "" },
      pay: { card: "" },
      done: { ok: false },
    },
    history: ["info"],
  };
}

function getProgress(state: WizardState) {
  const idx = STEP_ORDER.indexOf(state.step);
  return Math.round((idx / STEP_ORDER.length) * 100);
}

/* ── visual wizard demo ────────────────────────────────── */

const STEP_LABELS: Record<StepId, string> = {
  info: "Info",
  plan: "Plan",
  pay: "Payment",
  done: "Done",
};

interface ActionLogEntry {
  action: string;
  result: string;
}

function VisualWizardDemo({ isDark, mono }: { isDark: boolean; mono: string }) {
  const [state, setState] = useState<WizardState>(initialState);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);

  const dim = isDark ? "#555" : "#999";
  const faint = isDark ? "#1e1e1e" : "#e5e5e5";
  const accent = isDark ? "#fff" : "#0a0a0a";
  const green = isDark ? "#4ade80" : "#16a34a";
  const blue = isDark ? "#60a5fa" : "#2563eb";
  const panelBg = isDark ? "#0d0d0d" : "#f7f7f7";
  const inputBg = isDark ? "#1a1a1a" : "#fff";
  const surfaceBg = isDark ? "#111" : "#fafafa";

  const progress = getProgress(state);
  const idx = STEP_ORDER.indexOf(state.step);

  function logAction(action: string, result: string) {
    setActionLog((l) => [...l.slice(-4), { action, result }]);
  }

  function goNext() {
    const cfg = STEP_CONFIG[state.step];
    if (cfg.next.length === 0) return;
    const nextStep = cfg.next[0];
    setState((s) => ({
      ...s,
      step: nextStep,
      history: [...s.history, nextStep],
    }));
    logAction("next()", `\u2192 step: '${nextStep}'`);
  }

  function goBack() {
    if (state.history.length <= 1) return;
    const newHistory = state.history.slice(0, -1);
    const prev = newHistory[newHistory.length - 1];
    setState((s) => ({ ...s, step: prev, history: newHistory }));
    logAction("back()", `\u2190 step: '${prev}'`);
  }

  function resetWizard() {
    setState(initialState());
    setActionLog([]);
  }

  function updateData(key: string, value: unknown) {
    setState((s) => ({
      ...s,
      data: {
        ...s.data,
        [s.step]: { ...s.data[s.step], [key]: value },
      },
    }));
  }

  const canGoBack = state.history.length > 1;
  const canGoNext = STEP_CONFIG[state.step].next.length > 0;

  return (
    <div
      style={{
        border: `1px solid ${faint}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* step indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "24px 32px 16px",
          gap: 0,
        }}
      >
        {STEP_ORDER.map((stepId, i) => {
          const isActive = i === idx;
          const isComplete = i < idx;
          return (
            <React.Fragment key={stepId}>
              {i > 0 && (
                <div
                  style={{
                    width: 48,
                    height: 1,
                    marginTop: 14,
                    background: isComplete ? accent : faint,
                    transition: "background 0.3s ease",
                  }}
                />
              )}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 56,
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
                    fontFamily: mono,
                    transition: "all 0.3s ease",
                    background: isComplete || isActive ? accent : "transparent",
                    color:
                      isComplete || isActive
                        ? isDark
                          ? "#0a0a0a"
                          : "#fff"
                        : dim,
                    border: `1.5px solid ${isComplete || isActive ? accent : faint}`,
                  }}
                >
                  {isComplete ? "\u2713" : i + 1}
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: mono,
                    color: isActive ? accent : dim,
                    fontWeight: isActive ? 600 : 400,
                    letterSpacing: "0.02em",
                  }}
                >
                  {STEP_LABELS[stepId]}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* progress bar */}
      <div style={{ height: 1, background: faint, margin: "0 32px" }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: accent,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* step content */}
      <div style={{ padding: "28px 32px 8px", minHeight: 190 }}>
        {state.step === "info" && (
          <div>
            <h3
              style={{
                margin: "0 0 4px",
                fontSize: 17,
                fontWeight: 700,
                color: accent,
                letterSpacing: "-0.01em",
              }}
            >
              What's your name?
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: dim,
                lineHeight: 1.5,
              }}
            >
              Let's start with the basics.
            </p>
            <input
              type="text"
              placeholder="Enter your name..."
              value={(state.data.info.name as string) || ""}
              onChange={(e) => updateData("name", e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 13,
                fontFamily: mono,
                borderRadius: 6,
                border: `1px solid ${faint}`,
                background: inputBg,
                color: accent,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {state.step === "plan" && (
          <div>
            <h3
              style={{
                margin: "0 0 4px",
                fontSize: 17,
                fontWeight: 700,
                color: accent,
                letterSpacing: "-0.01em",
              }}
            >
              Choose your plan
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: dim,
                lineHeight: 1.5,
              }}
            >
              Pick the tier that fits your needs.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
              }}
            >
              {[
                {
                  id: "free",
                  label: "Free",
                  price: "$0",
                  desc: "For side projects",
                },
                {
                  id: "pro",
                  label: "Pro",
                  price: "$12",
                  desc: "For professionals",
                },
                {
                  id: "team",
                  label: "Team",
                  price: "$49",
                  desc: "For organizations",
                },
              ].map((plan) => {
                const selected = state.data.plan.tier === plan.id;
                return (
                  <button
                    key={plan.id}
                    onClick={() => {
                      updateData("tier", plan.id);
                      logAction(
                        `setStepData('plan', { tier: '${plan.id}' })`,
                        `data.tier = '${plan.id}'`,
                      );
                    }}
                    style={{
                      padding: "16px 12px",
                      borderRadius: 8,
                      border: `1.5px solid ${selected ? accent : faint}`,
                      background: selected
                        ? isDark
                          ? "rgba(255,255,255,0.04)"
                          : "rgba(0,0,0,0.02)"
                        : "transparent",
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.15s ease",
                      fontFamily: "inherit",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: accent,
                      }}
                    >
                      {plan.label}
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: accent,
                        margin: "6px 0 2px",
                      }}
                    >
                      {plan.price}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 400,
                          color: dim,
                        }}
                      >
                        /mo
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: dim }}>{plan.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {state.step === "pay" && (
          <div>
            <h3
              style={{
                margin: "0 0 4px",
                fontSize: 17,
                fontWeight: 700,
                color: accent,
                letterSpacing: "-0.01em",
              }}
            >
              Payment details
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: dim,
                lineHeight: 1.5,
              }}
            >
              Enter your card to complete signup.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <input
                type="text"
                placeholder="4242 4242 4242 4242"
                value={(state.data.pay.card as string) || ""}
                onChange={(e) => updateData("card", e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 13,
                  fontFamily: mono,
                  borderRadius: 6,
                  border: `1px solid ${faint}`,
                  background: inputBg,
                  color: accent,
                  outline: "none",
                  boxSizing: "border-box",
                  letterSpacing: "0.05em",
                }}
              />
            </div>
          </div>
        )}

        {state.step === "done" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: green,
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              {"\u2713"}
            </div>
            <h3
              style={{
                margin: "0 0 4px",
                fontSize: 17,
                fontWeight: 700,
                color: accent,
              }}
            >
              All done!
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: dim,
              }}
            >
              Your wizard flow is complete.
            </p>
            <button
              onClick={resetWizard}
              style={{
                padding: "6px 16px",
                fontSize: 12,
                fontFamily: mono,
                borderRadius: 6,
                border: `1px solid ${faint}`,
                background: "transparent",
                color: dim,
                cursor: "pointer",
              }}
            >
              start over
            </button>
          </div>
        )}
      </div>

      {/* navigation buttons */}
      {state.step !== "done" && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 32px 24px",
          }}
        >
          <button
            onClick={() => {
              goBack();
            }}
            disabled={!canGoBack}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: canGoBack
                ? `1px solid ${faint}`
                : "1px solid transparent",
              background: "transparent",
              color: canGoBack ? accent : "transparent",
              cursor: canGoBack ? "pointer" : "default",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            Back
          </button>
          <button
            onClick={() => {
              goNext();
            }}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 6,
              border: "none",
              background: accent,
              color: isDark ? "#0a0a0a" : "#fff",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            {state.step === "pay" ? "Complete" : "Next"}
          </button>
        </div>
      )}

      {/* state inspector panel */}
      <div
        style={{
          borderTop: `1px solid ${faint}`,
          background: panelBg,
          fontFamily: mono,
          fontSize: 11,
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
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: dim,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 600,
            }}
          >
            wizard state
          </span>
          <span style={{ fontSize: 10, color: dim }}>{progress}% complete</span>
        </div>

        {/* state values row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 0,
          }}
        >
          {[
            { label: "step", value: `'${state.step}'` },
            {
              label: "data",
              value: JSON.stringify(state.data[state.step]),
            },
            {
              label: "history",
              value: JSON.stringify(state.history),
            },
          ].map((item, i) => (
            <div
              key={item.label}
              style={{
                padding: "10px 16px",
                borderRight: i < 2 ? `1px solid ${faint}` : "none",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  color: dim,
                  fontSize: 10,
                  marginBottom: 4,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  color: accent,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1.4,
                }}
                title={item.value}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* action log */}
        {actionLog.length > 0 && (
          <div
            style={{
              borderTop: `1px solid ${faint}`,
              padding: "8px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {actionLog.slice(-3).map((entry, i) => (
              <div key={i} style={{ color: dim, fontSize: 10 }}>
                <span style={{ color: blue }}>{"\u203A "}</span>
                <span>{entry.action}</span>
                <span style={{ color: green, marginLeft: 8 }}>
                  {entry.result}
                </span>
              </div>
            ))}
          </div>
        )}
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

        {/* interactive demo */}
        <div style={{ marginBottom: 48 }}>
          <VisualWizardDemo isDark={isDark} mono={mono} />
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
