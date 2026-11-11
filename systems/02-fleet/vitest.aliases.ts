import { fileURLToPath } from 'node:url'
import sourceConfig from '../../tsconfig.source.json'

// Match the monorepo's source aliases so stale package builds never mask a contract change.
export const sourceAliases = [
  ...Object.entries(sourceConfig.compilerOptions.paths).map(([name, paths]) => ({
    find: name,
    replacement: fileURLToPath(new URL(`../../${paths[0]}`, import.meta.url)),
  })),
  {
    find: '@openwizard/fleet-shared',
    replacement: fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
  },
].sort((a, b) => b.find.length - a.find.length)
