import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

/** Services the caller supplies when it creates a run. */
export interface ReportDeps {
  reports: { download(reportId: string): Promise<{ pages: number }> }
}

export const report = defineWizard(
  {
    name: 'report',
    context: z.object({ reportId: z.string() }),
    deps: boundary.trusted<ReportDeps>(),
  },
  ({ step, steps }) =>
    steps({
      download: step({
        run: ({ context, deps }) => deps.reports.download(context.reportId),
        next: 'announce',
      }),
      announce: step({ run: ({ context }) => `Report ${context.reportId} is ready` }),
    }),
)

export const runReport = (deps: ReportDeps) => report.run({ reportId: 'r-1' }, { deps })
// { status: 'done', output: 'Report r-1 is ready' }
