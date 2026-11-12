import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface DeployDeps {
  ci: { build(version: string): Promise<{ image: string }> }
  cluster: {
    release(image: string, percent: number): Promise<{ releaseId: string }>
    rollback(releaseId: string): Promise<void>
  }
  metrics: { errorRate(version: string): Promise<number> }
}

export const deploy = defineWizard(
  {
    name: 'deploy',
    description: 'Ships a canary, lets it bake for ten minutes and rolls it back if errors rise.',
    context: z.object({ version: z.string() }),
    deps: boundary.trusted<DeployDeps>(),
    onFailure: 'compensate',
  },
  ({ step, steps }) => {
    const build = step({
      description: 'Builds the image.',
      run: ({ context, deps }) => deps.ci.build(context.version),
    })
    const canary = step({
      description: 'Sends 5% of traffic to the new image. Its undo rolls the release back.',
      needs: { build },
      run: ({ deps, needs }) => deps.cluster.release(needs.build.image, 5),
      compensate: ({ output, deps }) => deps.cluster.rollback(output.releaseId),
      next: 'bake',
    })
    const bake = step({
      description: 'Lets the canary take traffic.',
      sleep: '10m',
      next: 'health',
    })
    const health = step({
      description: 'Fails the run when more than 1% of requests error.',
      run: async ({ context, deps }) => {
        const rate = await deps.metrics.errorRate(context.version)
        if (rate > 0.01) throw new Error(`Error rate ${rate} is above 0.01`)
        return rate
      },
    })
    const promote = step({
      description: 'Sends all traffic to the new image.',
      needs: { build, health },
      run: ({ deps, needs }) => deps.cluster.release(needs.build.image, 100),
    })
    return steps({ build, canary, bake, health, promote })
  },
)
