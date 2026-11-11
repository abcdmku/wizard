/** Dependency providers retain authored identity without sharing compiled dependency bindings. */
const definitions = new WeakMap<object, object>()

export function inheritDefinition(definition: object, source: object): void {
  definitions.set(definition, definitions.get(source) ?? source)
}

export function sameDefinition(left: object, right: object): boolean {
  return (definitions.get(left) ?? left) === (definitions.get(right) ?? right)
}
