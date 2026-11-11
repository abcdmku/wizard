import { fileURLToPath } from 'node:url'
import sourceConfig from '../../tsconfig.source.json' with { type: 'json' }

const repositoryRoot = new URL('../../', import.meta.url)

export const sourceAliases = Object.entries(sourceConfig.compilerOptions.paths)
  .sort(([a], [b]) => b.length - a.length)
  .flatMap(([find, targets]) =>
    targets.map((target) => ({
      find,
      replacement: fileURLToPath(new URL(target, repositoryRoot)),
    })),
  )
