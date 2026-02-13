import React, { Suspense, lazy, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTheme } from "../src/theme/theme-provider";
import { withBase } from "../src/lib/base-path";
import type { Monaco } from "@monaco-editor/react";
import coreTypesDts from "../../core/dist/index.d.ts?raw";
import reactTypesDts from "../../react/dist/index.d.ts?raw";

type StepId = "info" | "plan" | "pay" | "done";

type IdeFile =
  | "src/wizard.ts"
  | "src/Signup.tsx"
  | "src/components/steps/InfoStep.tsx"
  | "src/components/steps/PlanStep.tsx"
  | "src/components/steps/PaymentStep.tsx";

interface DemoConfig {
  next: Record<StepId, StepId[]>;
  labels: Record<StepId, string>;
  titles: Record<StepId, string>;
  descriptions: Record<StepId, string>;
  placeholders: {
    info: string;
    pay: string;
  };
  doneMessage: string;
  resetLabel: string;
  nav: {
    backLabel: string;
    nextLabel: string;
    completeLabel: string;
  };
}

interface ParseResult {
  config: DemoConfig;
  error: string | null;
}

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((module) => ({
    default: module.default,
  })),
);

const STEP_ORDER: StepId[] = ["info", "plan", "pay", "done"];
const PHOTO_EDITOR_DARK_THEME = "wizard-photo-dark";
const PHOTO_EDITOR_LIGHT_THEME = "wizard-photo-light";

function configurePhotoEditorThemes(monaco: Monaco) {
  monaco.editor.defineTheme(PHOTO_EDITOR_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A9955" },
      { token: "keyword", foreground: "C586C0" },
      { token: "string", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "regexp", foreground: "D16969" },
      { token: "identifier", foreground: "9CDCFE" },
      { token: "variable", foreground: "9CDCFE" },
      { token: "type", foreground: "4EC9B0" },
      { token: "type.identifier", foreground: "4EC9B0" },
      { token: "function", foreground: "DCDCAA" },
      { token: "delimiter", foreground: "D4D4D4" },
      { token: "operator", foreground: "D4D4D4" },
    ],
    colors: {
      "editor.background": "#0D0D0D",
      "editor.foreground": "#D4D4D4",
      "editorLineNumber.foreground": "#6E7681",
      "editorLineNumber.activeForeground": "#D4D4D4",
      "editorCursor.foreground": "#AEAFAD",
      "editor.selectionBackground": "#264F78",
      "editor.inactiveSelectionBackground": "#3A3D41",
      "editorIndentGuide.background1": "#404040",
      "editorIndentGuide.activeBackground1": "#707070",
      "editorBracketHighlight.foreground1": "#FFD700",
      "editorBracketHighlight.foreground2": "#DA70D6",
      "editorBracketHighlight.foreground3": "#4EC9B0",
      "editorBracketHighlight.foreground4": "#569CD6",
      "editorBracketHighlight.foreground5": "#D7BA7D",
      "editorBracketHighlight.foreground6": "#C586C0",
      "editorBracketHighlight.unexpectedBracket.foreground": "#F44747",
    },
  });

  monaco.editor.defineTheme(PHOTO_EDITOR_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A737D" },
      { token: "keyword", foreground: "AF00DB" },
      { token: "string", foreground: "A31515" },
      { token: "number", foreground: "098658" },
      { token: "regexp", foreground: "811F3F" },
      { token: "identifier", foreground: "001080" },
      { token: "variable", foreground: "001080" },
      { token: "type", foreground: "267F99" },
      { token: "type.identifier", foreground: "267F99" },
      { token: "function", foreground: "795E26" },
      { token: "delimiter", foreground: "24292E" },
      { token: "operator", foreground: "24292E" },
    ],
    colors: {
      "editor.background": "#F8F8F8",
      "editor.foreground": "#24292E",
      "editorLineNumber.foreground": "#9CA3AF",
      "editorLineNumber.activeForeground": "#4B5563",
      "editorCursor.foreground": "#111827",
      "editor.selectionBackground": "#BFDBFE",
      "editor.inactiveSelectionBackground": "#DBEAFE",
      "editorIndentGuide.background1": "#E5E7EB",
      "editorIndentGuide.activeBackground1": "#CBD5E1",
      "editorBracketHighlight.foreground1": "#0EA5E9",
      "editorBracketHighlight.foreground2": "#F59E0B",
      "editorBracketHighlight.foreground3": "#8B5CF6",
      "editorBracketHighlight.foreground4": "#10B981",
      "editorBracketHighlight.foreground5": "#EF4444",
      "editorBracketHighlight.foreground6": "#2563EB",
      "editorBracketHighlight.unexpectedBracket.foreground": "#DC2626",
    },
  });
}

let typesConfigured = false;
function configureMonacoTypes(monaco: Monaco) {
  if (typesConfigured) return;
  typesConfigured = true;

  const ts = monaco.languages.typescript.typescriptDefaults;

  ts.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    strict: true,
    esModuleInterop: true,
    allowNonTsExtensions: true,
  });

  // @tanstack/store stub (dependency of @wizard/core)
  ts.addExtraLib(
    `declare module '@tanstack/store' {
  export class Store<TState> {
    state: TState;
    subscribe(listener: () => void): () => void;
    setState(updater: (state: TState) => TState): void;
  }
}`,
    "file:///node_modules/@tanstack/store/index.d.ts",
  );

  // React type stubs
  ts.addExtraLib(
    `declare module 'react' {
  export type ReactNode = string | number | boolean | null | undefined | ReactElement | ReactNode[];
  export interface ReactElement<P = any> { type: any; props: P; key: string | null; }
  export type ComponentType<P = {}> = (props: P) => ReactNode;
  export type FC<P = {}> = ComponentType<P>;
  export function createElement(type: any, props?: any, ...children: any[]): ReactElement;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly any[]): T;
  export function useCallback<T extends Function>(callback: T, deps: readonly any[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useContext<T>(context: Context<T>): T;
  export interface Context<T> {}
  export function createContext<T>(defaultValue: T): Context<T>;
}`,
    "file:///node_modules/@types/react/index.d.ts",
  );

  ts.addExtraLib(
    `declare module 'react/jsx-runtime' {
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements { [key: string]: any; }
  }
}`,
    "file:///node_modules/@types/react/jsx-runtime.d.ts",
  );

  // @wizard/core and @wizard/react types from built packages
  ts.addExtraLib(coreTypesDts, "file:///node_modules/@wizard/core/index.d.ts");
  ts.addExtraLib(
    reactTypesDts,
    "file:///node_modules/@wizard/react/index.d.ts",
  );
}

const IDE_FILES: Record<IdeFile, string> = {
  "src/wizard.ts": `import { createWizardFactory } from '@wizard/core';

const factory = createWizardFactory();

const steps = factory.defineSteps({
  info: factory.step({
    data: { name: '' },
    next: ['plan'],
    meta: {
      label: 'Info',
      title: "What's your name?",
      description: "Let's start with the basics.",
      placeholder: 'Enter your name...',
    },
  }),
  plan: factory.step({
    data: { tier: '' },
    next: ['pay'],
    meta: {
      label: 'Plan',
      title: 'Choose your plan',
      description: 'Pick the tier that fits your needs.',
    },
  }),
  pay: factory.step({
    data: { card: '' },
    next: ['done'],
    meta: {
      label: 'Payment',
      title: 'Payment details',
      description: 'Enter your card to complete signup.',
      placeholder: '4242 4242 4242 4242',
    },
  }),
  done: factory.step({
    data: { ok: false },
    next: [],
    meta: {
      label: 'Done',
      title: 'All done!',
      doneMessage: 'Your wizard flow is complete.',
      resetLabel: 'start over',
    },
  }),
});

export const wizard = factory.createWizard(steps, {
  context: {},
});`,
  "src/Signup.tsx": `import { useWizard } from '@wizard/react';
import { wizard } from './wizard';

const backLabel = 'Back';
const nextLabel = 'Next';
const completeLabel = 'Complete';

export function Signup() {
  const { step, next, back, helpers } = useWizard(wizard);
  const { percent } = helpers.progress();

  return (
    <div>
      <ProgressBar value={percent} />
      <StepTitle id={step} />

      <WizardStepRenderer
        step={step}
        onBack={back}
        onNext={next}
        labels={{ backLabel, nextLabel, completeLabel }}
      />
    </div>
  );
}`,
  "src/components/steps/InfoStep.tsx": `export function InfoStep() {
  return (
    <Field
      label="Name"
      placeholder="Enter your name..."
    />
  );
}`,
  "src/components/steps/PlanStep.tsx": `const plans = [
  { id: 'free', label: 'Free', price: '$0/mo' },
  { id: 'pro', label: 'Pro', price: '$12/mo' },
  { id: 'team', label: 'Team', price: '$49/mo' },
];

export function PlanStep() {
  return <PlanCards plans={plans} />;
}`,
  "src/components/steps/PaymentStep.tsx": `export function PaymentStep() {
  return (
    <Field
      label="Card number"
      placeholder="4242 4242 4242 4242"
    />
  );
}`,
};

const IDE_FILE_ORDER: IdeFile[] = [
  "src/wizard.ts",
  "src/Signup.tsx",
  "src/components/steps/InfoStep.tsx",
  "src/components/steps/PlanStep.tsx",
  "src/components/steps/PaymentStep.tsx",
];

function displayFileName(file: IdeFile) {
  const parts = file.split("/");
  return parts[parts.length - 1];
}

const PLAN_OPTIONS = [
  { id: "free", label: "Free", price: "$0/mo" },
  { id: "pro", label: "Pro", price: "$12/mo" },
  { id: "team", label: "Team", price: "$49/mo" },
] as const;

const BASE_CONFIG: DemoConfig = {
  next: {
    info: ["plan"],
    plan: ["pay"],
    pay: ["done"],
    done: [],
  },
  labels: {
    info: "Info",
    plan: "Plan",
    pay: "Payment",
    done: "Done",
  },
  titles: {
    info: "What's your name?",
    plan: "Choose your plan",
    pay: "Payment details",
    done: "All done!",
  },
  descriptions: {
    info: "Let's start with the basics.",
    plan: "Pick the tier that fits your needs.",
    pay: "Enter your card to complete signup.",
    done: "Your wizard flow is complete.",
  },
  placeholders: {
    info: "Enter your name...",
    pay: "4242 4242 4242 4242",
  },
  doneMessage: "Your wizard flow is complete.",
  resetLabel: "start over",
  nav: {
    backLabel: "Back",
    nextLabel: "Next",
    completeLabel: "Complete",
  },
};

function cloneConfig(config: DemoConfig): DemoConfig {
  return {
    next: {
      info: [...config.next.info],
      plan: [...config.next.plan],
      pay: [...config.next.pay],
      done: [...config.next.done],
    },
    labels: { ...config.labels },
    titles: { ...config.titles },
    descriptions: { ...config.descriptions },
    placeholders: { ...config.placeholders },
    doneMessage: config.doneMessage,
    resetLabel: config.resetLabel,
    nav: { ...config.nav },
  };
}

function extractObjectString(source: string, key: string): string | null {
  const pattern = new RegExp(`${key}\\s*:\\s*[\"']([^\"']+)[\"']`);
  const match = source.match(pattern);
  return match ? match[1] : null;
}

function extractConstString(source: string, key: string): string | null {
  const pattern = new RegExp(`${key}\\s*=\\s*[\"']([^\"']+)[\"']`);
  const match = source.match(pattern);
  return match ? match[1] : null;
}

function extractStepBody(code: string, stepId: StepId): string | null {
  const pattern = new RegExp(
    `${stepId}\\s*:\\s*factory\\.step\\(\\{([\\s\\S]*?)\\}\\),?`,
    "m",
  );
  const match = code.match(pattern);
  return match ? match[1] : null;
}

function parseWizardConfig(code: string): ParseResult {
  const config = cloneConfig(BASE_CONFIG);
  let parsedStepCount = 0;

  for (const stepId of STEP_ORDER) {
    const body = extractStepBody(code, stepId);
    if (!body) {
      continue;
    }

    parsedStepCount += 1;

    const nextMatch = body.match(/next\s*:\s*\[(.*?)\]/);
    if (nextMatch) {
      const parsedNext = Array.from(
        nextMatch[1].matchAll(/["'](info|plan|pay|done)["']/g),
      ).map((value) => value[1] as StepId);
      config.next[stepId] = parsedNext;
    }

    const label = extractObjectString(body, "label");
    if (label) config.labels[stepId] = label;

    const title = extractObjectString(body, "title");
    if (title) config.titles[stepId] = title;

    const description = extractObjectString(body, "description");
    if (description) config.descriptions[stepId] = description;

    if (stepId === "info") {
      const placeholder = extractObjectString(body, "placeholder");
      if (placeholder) config.placeholders.info = placeholder;
    }

    if (stepId === "pay") {
      const placeholder = extractObjectString(body, "placeholder");
      if (placeholder) config.placeholders.pay = placeholder;
    }

    if (stepId === "done") {
      const doneMessage = extractObjectString(body, "doneMessage");
      if (doneMessage) config.doneMessage = doneMessage;

      const resetLabel = extractObjectString(body, "resetLabel");
      if (resetLabel) config.resetLabel = resetLabel;
    }
  }

  if (parsedStepCount === 0) {
    return {
      config,
      error:
        "Could not parse wizard.ts. Keep factory.step({ ... }) blocks for info/plan/pay/done.",
    };
  }

  return { config, error: null };
}

function parseSignupLabels(code: string): Partial<DemoConfig["nav"]> {
  return {
    backLabel: extractConstString(code, "backLabel") ?? undefined,
    nextLabel: extractConstString(code, "nextLabel") ?? undefined,
    completeLabel: extractConstString(code, "completeLabel") ?? undefined,
  };
}

function CopyBtn({ text, isDark }: { text: string; isDark: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      style={{
        border: "none",
        cursor: "pointer",
        fontSize: 11,
        borderRadius: 5,
        padding: "3px 8px",
        background: copied
          ? isDark
            ? "rgba(255,255,255,0.08)"
            : "rgba(0,0,0,0.06)"
          : "transparent",
        color: isDark ? "#666" : "#999",
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function DocsMonacoEditor({
  value,
  onChange,
  fileName,
  mono,
  isDark,
}: {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
  mono: string;
  isDark: boolean;
}) {
  const editorSurface = isDark ? "#0d0d0d" : "#f8f8f8";
  const editorTheme = isDark
    ? PHOTO_EDITOR_DARK_THEME
    : PHOTO_EDITOR_LIGHT_THEME;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: editorSurface,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <Suspense
        fallback={
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#6b7280",
              fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Loading editor...
          </div>
        }
      >
        <MonacoEditor
          beforeMount={(monaco) => {
            configurePhotoEditorThemes(monaco);
            configureMonacoTypes(monaco);
          }}
          path={fileName}
          language={
            fileName.endsWith(".tsx") ? "typescriptreact" : "typescript"
          }
          theme={editorTheme}
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? "")}
          height="100%"
          options={{
            readOnly: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: mono,
            lineNumbers: "on",
            lineNumbersMinChars: 3,
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 8,
            overviewRulerLanes: 0,
            overviewRulerBorder: false,
            renderLineHighlight: "none",
            tabSize: 2,
            automaticLayout: true,
            renderWhitespace: "selection",
            bracketPairColorization: { enabled: true },
            scrollbar: {
              vertical: "auto",
              horizontal: "auto",
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            padding: { top: 6, bottom: 6 },
          }}
        />
      </Suspense>
    </div>
  );
}

function LiveWizardPreview({
  config,
  isDark,
  mono,
}: {
  config: DemoConfig;
  isDark: boolean;
  mono: string;
}) {
  const [step, setStep] = useState<StepId>("info");
  const [history, setHistory] = useState<StepId[]>(["info"]);
  const [data, setData] = useState({
    info: { name: "" },
    plan: { tier: "" },
    pay: { card: "" },
    done: { ok: false },
  });

  const dim = isDark ? "#888" : "#666";
  const faint = isDark ? "#2b2b2b" : "#e5e5e5";
  const bg = isDark ? "#0a0a0a" : "#fff";
  const fg = isDark ? "#ececec" : "#111";

  const index = STEP_ORDER.indexOf(step);

  function updateStepData(patch: Record<string, unknown>) {
    setData((current) => ({
      ...current,
      [step]: {
        ...(current[step] as Record<string, unknown>),
        ...patch,
      },
    }));
  }

  function validate(id: StepId): boolean {
    if (id === "info") return data.info.name.trim().length > 0;
    if (id === "plan") return data.plan.tier.trim().length > 0;
    if (id === "pay") return data.pay.card.trim().length >= 4;
    return true;
  }

  function goBack() {
    if (history.length <= 1) return;
    const nextHistory = history.slice(0, -1);
    setHistory(nextHistory);
    setStep(nextHistory[nextHistory.length - 1]);
  }

  function goNext() {
    const nextStep = (config.next[step] ?? [])[0];
    if (!nextStep || !validate(step)) return;
    setStep(nextStep);
    setHistory((current) => [...current, nextStep]);
  }

  function reset() {
    setStep("info");
    setHistory(["info"]);
    setData({
      info: { name: "" },
      plan: { tier: "" },
      pay: { card: "" },
      done: { ok: false },
    });
  }

  return (
    <div
      style={{
        border: `1px solid ${faint}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 10,
          borderBottom: `1px solid ${faint}`,
        }}
      >
        {STEP_ORDER.map((id, i) => {
          const active = id === step;
          const complete = i < index;
          return (
            <button
              key={id}
              onClick={() => {
                if (i <= index) setStep(id);
              }}
              style={{
                border: `1px solid ${active ? fg : faint}`,
                background: active
                  ? isDark
                    ? "#161616"
                    : "#f5f5f5"
                  : "transparent",
                color: complete ? (isDark ? "#86efac" : "#15803d") : fg,
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 11,
                fontFamily: mono,
                cursor: i <= index ? "pointer" : "default",
                opacity: i <= index ? 1 : 0.5,
              }}
            >
              {config.labels[id]}
            </button>
          );
        })}
      </div>

      <div style={{ padding: 14, minHeight: 220, background: bg }}>
        <h3 style={{ margin: "0 0 4px", color: fg, fontSize: 17 }}>
          {config.titles[step]}
        </h3>
        <p style={{ margin: "0 0 14px", color: dim, fontSize: 13 }}>
          {config.descriptions[step]}
        </p>

        {step === "info" && (
          <input
            value={data.info.name}
            onChange={(event) => updateStepData({ name: event.target.value })}
            placeholder={config.placeholders.info}
            style={{
              width: "100%",
              border: `1px solid ${faint}`,
              borderRadius: 6,
              padding: "10px 12px",
              background: isDark ? "#111" : "#fff",
              color: fg,
            }}
          />
        )}

        {step === "plan" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 8,
            }}
          >
            {PLAN_OPTIONS.map((plan) => {
              const selected = data.plan.tier === plan.id;
              return (
                <button
                  key={plan.id}
                  onClick={() => updateStepData({ tier: plan.id })}
                  style={{
                    border: `1px solid ${selected ? fg : faint}`,
                    borderRadius: 8,
                    padding: 10,
                    background: selected
                      ? isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(0,0,0,0.03)"
                      : "transparent",
                    color: fg,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {plan.label}
                  </div>
                  <div style={{ fontSize: 12, color: dim }}>{plan.price}</div>
                </button>
              );
            })}
          </div>
        )}

        {step === "pay" && (
          <input
            value={data.pay.card}
            onChange={(event) => {
              const raw = event.target.value.replace(/\D/g, "").slice(0, 16);
              const formatted = raw.replace(/(.{4})/g, "$1 ").trim();
              updateStepData({ card: formatted });
            }}
            placeholder={config.placeholders.pay}
            style={{
              width: "100%",
              border: `1px solid ${faint}`,
              borderRadius: 6,
              padding: "10px 12px",
              background: isDark ? "#111" : "#fff",
              color: fg,
            }}
          />
        )}

        {step === "done" && (
          <div>
            <p style={{ color: dim, marginBottom: 12 }}>{config.doneMessage}</p>
            <button
              onClick={reset}
              style={{
                border: `1px solid ${faint}`,
                background: "transparent",
                borderRadius: 6,
                padding: "8px 12px",
                color: fg,
              }}
            >
              {config.resetLabel}
            </button>
          </div>
        )}
      </div>

      {step !== "done" && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${faint}`,
            padding: 12,
            background: isDark ? "#0d0d0d" : "#fafafa",
          }}
        >
          <button
            onClick={goBack}
            disabled={history.length <= 1}
            style={{
              border: `1px solid ${faint}`,
              background: "transparent",
              borderRadius: 6,
              padding: "7px 12px",
              color: history.length <= 1 ? "transparent" : fg,
              cursor: history.length <= 1 ? "default" : "pointer",
            }}
          >
            {config.nav.backLabel}
          </button>
          <button
            onClick={goNext}
            disabled={!validate(step)}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "7px 12px",
              color: isDark ? "#111" : "#fff",
              background: validate(step)
                ? isDark
                  ? "#e5e5e5"
                  : "#111"
                : isDark
                  ? "#333"
                  : "#ccc",
              cursor: validate(step) ? "pointer" : "not-allowed",
            }}
          >
            {step === "pay" ? config.nav.completeLabel : config.nav.nextLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function WizardIde({ isDark, mono }: { isDark: boolean; mono: string }) {
  const [files, setFiles] = useState<Record<IdeFile, string>>(IDE_FILES);
  const [activeFile, setActiveFile] = useState<IdeFile>("src/wizard.ts");
  const [mobileView, setMobileView] = useState<"code" | "preview">("code");

  const parseResult = useMemo(
    () => parseWizardConfig(files["src/wizard.ts"]),
    [files["src/wizard.ts"]],
  );
  const signupLabels = useMemo(
    () => parseSignupLabels(files["src/Signup.tsx"]),
    [files["src/Signup.tsx"]],
  );

  const previewConfig = useMemo(() => {
    const config = cloneConfig(parseResult.config);
    config.nav = { ...config.nav, ...signupLabels };
    return config;
  }, [parseResult, signupLabels]);

  const faint = isDark ? "#2b2b2b" : "#e5e5e5";
  const panelBg = isDark ? "#0d0d0d" : "#f8f8f8";
  const fg = isDark ? "#eaeaea" : "#121212";
  const dim = isDark ? "#808080" : "#666";

  return (
    <div
      className="flex flex-col h-full"
      style={{
        border: `1px solid ${faint}`,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: isDark
          ? "0 4px 40px rgba(0,0,0,0.5)"
          : "0 4px 40px rgba(0,0,0,0.07)",
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          borderBottom: `1px solid ${faint}`,
          padding: "8px 12px",
          background: panelBg,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#ef4444",
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#f59e0b",
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#10b981",
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: dim,
              fontFamily: mono,
              marginLeft: 4,
            }}
          >
            Wizard IDE
          </span>
        </div>
        <CopyBtn text={files[activeFile]} isDark={isDark} />
      </div>

      {/* Mobile toggle: Code / Preview */}
      <div
        className="flex lg:hidden shrink-0"
        style={{
          borderBottom: `1px solid ${faint}`,
          background: panelBg,
        }}
      >
        {(["code", "preview"] as const).map((view) => (
          <button
            key={view}
            onClick={() => setMobileView(view)}
            style={{
              flex: 1,
              padding: "8px 0",
              fontSize: 12,
              fontFamily: mono,
              textTransform: "capitalize",
              border: "none",
              borderBottom:
                mobileView === view
                  ? `2px solid ${fg}`
                  : "2px solid transparent",
              background: "transparent",
              color: mobileView === view ? fg : dim,
              cursor: "pointer",
            }}
          >
            {view}
          </button>
        ))}
      </div>

      {/* File tabs */}
      <div
        className={`shrink-0 overflow-x-auto ${mobileView === "preview" ? "hidden lg:flex" : "flex"}`}
        style={{
          borderBottom: `1px solid ${faint}`,
          background: panelBg,
          padding: "0 8px",
          gap: 2,
        }}
      >
        {IDE_FILE_ORDER.map((file) => {
          const selected = file === activeFile;
          return (
            <button
              key={file}
              onClick={() => setActiveFile(file)}
              style={{
                padding: "8px 10px",
                fontSize: 12,
                fontFamily: mono,
                border: "none",
                borderBottom: selected
                  ? `2px solid ${fg}`
                  : "2px solid transparent",
                background: "transparent",
                color: selected ? fg : dim,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {displayFileName(file)}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Editor panel */}
        <div
          className={`min-w-0 min-h-0 ${mobileView === "preview" ? "hidden lg:block" : "block"} flex-1`}
          style={{
            position: "relative",
            borderRight: `1px solid ${faint}`,
            background: panelBg,
          }}
        >
          <div style={{ position: "absolute", inset: 0 }}>
            <DocsMonacoEditor
              value={files[activeFile]}
              onChange={(content) =>
                setFiles((current) => ({ ...current, [activeFile]: content }))
              }
              fileName={activeFile}
              mono={mono}
              isDark={isDark}
            />
          </div>
        </div>

        {/* Preview panel */}
        <div
          className={`lg:w-[280px] xl:w-[340px] shrink-0 overflow-y-auto ${mobileView === "code" ? "hidden lg:block" : "block w-full"}`}
          style={{
            padding: 12,
            background: isDark ? "#0a0a0a" : "#fff",
          }}
        >
          <div
            style={{
              border: `1px solid ${faint}`,
              borderRadius: 8,
              marginBottom: 10,
              padding: "6px 10px",
              fontSize: 11,
              color: parseResult.error ? (isDark ? "#fca5a5" : "#b91c1c") : dim,
              background: isDark ? "#0d0d0d" : "#fafafa",
            }}
          >
            {parseResult.error
              ? parseResult.error
              : "Live preview synced with your code."}
          </div>
          <LiveWizardPreview
            config={previewConfig}
            isDark={isDark}
            mono={mono}
          />
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const mono =
    "'SF Mono', ui-monospace, Consolas, 'Liberation Mono', monospace";
  const currentYear = new Date().getUTCFullYear();

  return (
    <div
      className={`${isDark ? "bg-[#0a0a0a]" : "bg-white"} min-h-screen lg:h-dvh lg:overflow-hidden flex flex-col`}
    >
      {/* Main content — unified single canvas */}
      <div className="flex-1 flex flex-col lg:flex-row lg:items-center lg:justify-center gap-8 lg:gap-12 xl:gap-16 px-6 lg:px-10 xl:px-14 py-8 lg:py-0 min-h-0">
        {/* Hero */}
        <div className="shrink-0 lg:text-right lg:max-w-[340px] xl:max-w-[380px]">
          <h1
            className={`text-5xl lg:text-6xl xl:text-7xl font-black leading-[0.92] ${
              isDark ? "text-white" : "text-[#0a0a0a]"
            }`}
            style={{ letterSpacing: "-0.045em" }}
          >
            OpenWizard
          </h1>
          <p
            className={`text-[15px] leading-relaxed mt-5 ${
              isDark ? "text-neutral-400" : "text-neutral-500"
            }`}
          >
            Type-safe multi-step flows.{" "}
            <span className={isDark ? "text-neutral-300" : "text-neutral-600"}>
              Headless engine, full TypeScript inference, zero UI lock-in.
            </span>
          </p>

          <div className="flex items-center lg:justify-end gap-4 mt-5">
            <Link
              to="/$"
              params={{ _splat: "getting-started" }}
              className={`no-underline text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors ${
                isDark
                  ? "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  : "bg-neutral-200 text-neutral-600 hover:bg-neutral-300"
              }`}
            >
              View Docs
            </Link>
            <Link
              to="/$"
              params={{ _splat: "examples" }}
              className={`no-underline text-[13px] font-medium transition-colors ${
                isDark
                  ? "text-neutral-500 hover:text-white"
                  : "text-neutral-400 hover:text-[#0a0a0a]"
              }`}
            >
              Examples &rarr;
            </Link>
          </div>

          {/* Install command */}
          <div
            className={`inline-flex items-center gap-3 mt-5 text-[13px] rounded-lg px-4 py-2.5 border lg:ml-auto ${
              isDark
                ? "border-neutral-800 text-neutral-400"
                : "border-neutral-200 text-neutral-500"
            }`}
            style={{ fontFamily: mono }}
          >
            <span
              className={`select-none ${
                isDark ? "text-neutral-600" : "text-neutral-300"
              }`}
            >
              $
            </span>
            <span>npm i @wizard/core @wizard/react</span>
            <CopyBtn text="npm i @wizard/core @wizard/react" isDark={isDark} />
          </div>
        </div>

        {/* IDE — 16:10 aspect ratio, height-driven on desktop */}
        <div className="flex-1 flex items-center min-w-0">
          {/* Mobile header */}
          <div className="lg:hidden w-full">
            <h2
              className={`text-2xl font-bold tracking-tight mb-3 ${
                isDark ? "text-white" : "text-[#0a0a0a]"
              }`}
            >
              Try it live
            </h2>
            <div className="h-[460px]">
              <WizardIde isDark={isDark} mono={mono} />
            </div>
          </div>

          {/* Desktop IDE — height constrained, 16:10 aspect */}
          <div
            className="hidden lg:block w-auto"
            style={{
              height: "min(calc(100dvh - 120px), 640px)",
              aspectRatio: "16 / 10",
              maxWidth: "100%",
            }}
          >
            <WizardIde isDark={isDark} mono={mono} />
          </div>
        </div>
      </div>

      {/* Footer — unified, always visible */}
      <footer
        className={`shrink-0 px-6 lg:px-10 xl:px-14 py-3 flex items-center justify-between text-[11px] ${
          isDark ? "text-neutral-600" : "text-neutral-400"
        }`}
      >
        <span suppressHydrationWarning>&copy; {currentYear} Wizard</span>
        <div className="flex gap-3">
          <Link
            to="/$"
            params={{ _splat: "getting-started" }}
            className={`no-underline transition-colors ${
              isDark
                ? "text-neutral-600 hover:text-white"
                : "text-neutral-400 hover:text-[#0a0a0a]"
            }`}
          >
            Docs
          </Link>
          <a
            href={withBase("/typedoc/")}
            className={`no-underline transition-colors ${
              isDark
                ? "text-neutral-600 hover:text-white"
                : "text-neutral-400 hover:text-[#0a0a0a]"
            }`}
          >
            API
          </a>
          <Link
            to="/$"
            params={{ _splat: "examples" }}
            className={`no-underline transition-colors ${
              isDark
                ? "text-neutral-600 hover:text-white"
                : "text-neutral-400 hover:text-[#0a0a0a]"
            }`}
          >
            Examples
          </Link>
        </div>
      </footer>
    </div>
  );
}
