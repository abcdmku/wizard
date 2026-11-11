import type { AnyFlow, TypesOf } from '../authoring/types'

/** State facts shared by a wizard and its provided variants.
 * @public
 */
export type ProjectionDefinition<F extends AnyFlow> = Omit<AnyFlow, '~types'> & {
  readonly '~types': (Omit<TypesOf<F>, 'provided'> & { readonly provided: PropertyKey }) | undefined
}
