import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface ResearchDeps {
  model: {
    plan(question: string): Promise<{ queries: string[] }>
    write(question: string, notes: string[]): Promise<string>
  }
  search: { run(query: string): Promise<string> }
}

export const research = defineWizard(
  {
    name: 'research',
    description: 'An agent plans searches, runs each one, drafts an answer and waits for a person.',
    context: z.object({ question: z.string() }),
    deps: boundary.trusted<ResearchDeps>(),
  },
  ({ step, view, steps }) => {
    const plan = step({
      description: 'The model turns the question into searches.',
      run: ({ context, deps }) => deps.model.plan(context.question),
    })
    const search = step({
      description: 'Runs every search, two at a time. A failed search retries alone.',
      needs: { plan },
      each: ({ needs }) => needs.plan.queries,
      concurrency: 2,
      run: ({ item, deps }) => deps.search.run(item),
      retry: { retries: 1 },
    })
    const draft = step({
      description: 'The model writes an answer from the search results.',
      needs: { search },
      run: ({ context, deps, needs }) => deps.model.write(context.question, needs.search),
      next: 'review',
    })
    const review = view({
      description: 'A person reads the draft and decides whether it goes out.',
      input: z.object({ approve: z.boolean(), note: z.string() }),
    })
    const publish = step({
      description: 'Returns the answer, or the reason it was held back.',
      needs: { draft, review },
      run: ({ needs }) =>
        needs.review.approve ? { answer: needs.draft } : { answer: null, held: needs.review.note },
    })
    return steps({ plan, search, draft, review, publish })
  },
)
