import { fileURLToPath } from 'node:url'
import sourceConfig from '../../tsconfig.source.json' with { type: 'json' }

const workspace = new URL('../../', import.meta.url)

// Tests use package sources so stale dist output cannot mask API changes.
export const sourceAliases = Object.entries(sourceConfig.compilerOptions.paths)
  .sort(([left], [right]) => right.length - left.length)
  .flatMap(([find, targets]) =>
    targets.map((target) => ({
      find,
      replacement: fileURLToPath(new URL(target, workspace)),
    })),
  )
