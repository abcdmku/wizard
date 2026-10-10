/**
 * Client-only Monaco bootstrap (imported dynamically, never during prerender): a trimmed editor
 * bundle (editor features + TypeScript only), self-hosted web workers, two monochrome themes,
 * and the TypeScript language service fed with the BUILT `@openwizard/core` declarations plus
 * the real `zod` types — so hovers, completions and errors in the playground are the real ones.
 */
import { Editor, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import 'monaco-editor/features/register.all.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import { monacoLibs } from 'virtual:monaco-libs'
import {
  getTypeScriptWorker,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  typescriptDefaults,
} from 'monaco-editor/languages/features/typescript/register.js'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker'

export type Monaco = typeof monaco
/** What the sandbox needs from Monaco: the editor API (models) and the TypeScript worker factory. */
export interface MonacoApi {
  readonly monaco: Monaco
  readonly getTypeScriptWorker: typeof getTypeScriptWorker
}
export { Editor, getTypeScriptWorker, monaco }

export const THEME_DARK = 'ow-dark'
export const THEME_LIGHT = 'ow-light'

function defineThemes(): void {
  monaco.editor.defineTheme(THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955' },
      { token: 'keyword', foreground: 'C586C0' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'type.identifier', foreground: '4EC9B0' },
      { token: 'identifier', foreground: '9CDCFE' },
      { token: 'delimiter', foreground: 'D4D4D4' },
    ],
    colors: {
      'editor.background': '#0d0d0d',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#4b4b4b',
      'editorLineNumber.activeForeground': '#a3a3a3',
      'editor.lineHighlightBackground': '#0d0d0d',
      'editorIndentGuide.background1': '#262626',
      'editorIndentGuide.activeBackground1': '#404040',
      'editorWidget.background': '#141414',
      'editorWidget.border': '#2a2a2a',
      'editorHoverWidget.background': '#141414',
      'editorHoverWidget.border': '#2a2a2a',
      'editorSuggestWidget.background': '#141414',
      'editorSuggestWidget.border': '#2a2a2a',
      'editorSuggestWidget.selectedBackground': '#262626',
      'scrollbarSlider.background': '#33333380',
    },
  })
  monaco.editor.defineTheme(THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A737D' },
      { token: 'keyword', foreground: 'AF00DB' },
      { token: 'string', foreground: 'A31515' },
      { token: 'number', foreground: '098658' },
      { token: 'type', foreground: '267F99' },
      { token: 'type.identifier', foreground: '267F99' },
      { token: 'identifier', foreground: '001080' },
      { token: 'delimiter', foreground: '24292E' },
    ],
    colors: {
      'editor.background': '#f8f8f8',
      'editor.foreground': '#24292e',
      'editorLineNumber.foreground': '#b3b3b3',
      'editorLineNumber.activeForeground': '#525252',
      'editor.lineHighlightBackground': '#f8f8f8',
      'editorIndentGuide.background1': '#e5e5e5',
      'editorIndentGuide.activeBackground1': '#cfcfcf',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e5e5e5',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#e5e5e5',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e5e5e5',
      'scrollbarSlider.background': '#d4d4d480',
    },
  })
}

function configureTypeScript(): void {
  typescriptDefaults.setCompilerOptions({
    target: ScriptTarget.ESNext,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.NodeJs,
    lib: ['esnext', 'dom', 'dom.iterable'],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    allowNonTsExtensions: true,
    isolatedModules: true,
    types: [],
  })
  typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })
  typescriptDefaults.setEagerModelSync(true)
  typescriptDefaults.setExtraLibs(
    Object.entries(monacoLibs).map(([filePath, content]) => ({ filePath, content })),
  )
}

let configured = false

/** Idempotent: wires workers, the loader, themes and the TypeScript defaults once per page. */
export function setupMonaco(): Monaco {
  if (configured) return monaco
  configured = true
  self.MonacoEnvironment = {
    getWorker: (_workerId: string, label: string) =>
      label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker(),
  }
  loader.config({ monaco })
  defineThemes()
  configureTypeScript()
  return monaco
}
