/**
 * Turn the editor's TypeScript models into JavaScript with the SAME TypeScript that powers the
 * editor (Monaco's language-service worker): `getEmitOutput` per file, plus the syntactic and
 * semantic diagnostics so the preview can list type errors next to the code.
 */
import type { MonacoApi } from './monaco-setup'

export interface PlaygroundDiagnostic {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly message: string
  readonly category: 'error' | 'warning'
}

export interface TranspileResult {
  /** File name → emitted ES module source. */
  readonly modules: ReadonlyMap<string, string>
  readonly diagnostics: readonly PlaygroundDiagnostic[]
}

type MessageChain = { messageText: string; next?: MessageChain[] }

function flattenMessage(text: string | MessageChain): string {
  if (typeof text === 'string') return text
  const rest = text.next?.map((chain) => flattenMessage(chain)).join(' ') ?? ''
  return rest ? `${text.messageText} ${rest}` : text.messageText
}

export async function transpileFiles(
  { monaco, getTypeScriptWorker }: MonacoApi,
  fileNames: readonly string[],
): Promise<TranspileResult> {
  const uris = fileNames.map((name) => monaco.Uri.parse(`file:///${name}`))
  const client = await (await getTypeScriptWorker())(...uris)
  const modules = new Map<string, string>()
  const diagnostics: PlaygroundDiagnostic[] = []
  for (const [index, uri] of uris.entries()) {
    const name = fileNames[index] ?? ''
    const model = monaco.editor.getModel(uri)
    const key = uri.toString()
    const [emit, syntactic, semantic] = await Promise.all([
      client.getEmitOutput(key),
      client.getSyntacticDiagnostics(key),
      client.getSemanticDiagnostics(key),
    ])
    const js = emit.outputFiles.find((file) => file.name.endsWith('.js'))?.text
    if (js !== undefined) modules.set(name, js)
    for (const diagnostic of [...syntactic, ...semantic]) {
      const position =
        model && diagnostic.start !== undefined ? model.getPositionAt(diagnostic.start) : null
      diagnostics.push({
        file: name,
        line: position?.lineNumber ?? 1,
        column: position?.column ?? 1,
        message: flattenMessage(diagnostic.messageText),
        category: diagnostic.category === 1 ? 'error' : 'warning',
      })
    }
  }
  return { modules, diagnostics }
}
