import { extname } from 'node:path'
import ts from 'typescript'

const TRANSPORT_SUFFIX =
  /(?:command|context|data|dto|entity|event|input|model|output|payload|projection|request|response|type|view)$/i
const UNKNOWN_EXPLANATION =
  /(?:\/\/|\/\*|\*)[^\n]*dx-audit:\s*(?:allow-)?as-unknown\s*(?:--|:)\s*(\S.{7,})/i

export function inspectSystemSources(files) {
  const violations = []
  const declarations = []
  const schemasBySystem = new Map()

  for (const file of files) {
    const inspected = inspectTypeScriptSource(file.path, file.content)
    violations.push(...inspected.violations)
    declarations.push(...inspected.declarations)
    const system = systemName(file.path)
    const schemas = schemasBySystem.get(system) ?? new Set()
    for (const schema of inspected.schemas) schemas.add(`${schema.concept}\0${schema.keys}`)
    schemasBySystem.set(system, schemas)
  }

  violations.push(...findSchemaDuplicates(declarations, schemasBySystem))
  violations.push(...findRepeatedDeclarations(declarations))
  return violations
}

export function inspectTypeScriptSource(path, content) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path))
  const violations = []

  function visit(node) {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      if (node.type.kind === ts.SyntaxKind.AnyKeyword) {
        violations.push(atNode(source, node, 'no-as-any', "Type assertions to 'any' are banned."))
      }
      if (node.type.kind === ts.SyntaxKind.UnknownKeyword && !hasUnknownExplanation(source, node)) {
        violations.push(
          atNode(
            source,
            node,
            'unexplained-as-unknown',
            "Explain this assertion with 'dx-audit: as-unknown -- <reason>'.",
          ),
        )
      }
    }

    if (ts.isNonNullExpression(node)) {
      violations.push(
        atNode(source, node, 'no-non-null', 'Non-null assertions are banned in system code.'),
      )
    }
    if (
      (ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.exclamationToken
    ) {
      violations.push(
        atNode(
          source,
          node,
          'no-definite-assignment',
          'Definite-assignment assertions are banned.',
        ),
      )
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return {
    declarations: collectDeclarations(source),
    schemas: collectSchemaContracts(source),
    violations,
  }
}

function collectDeclarations(source) {
  const declarations = []
  for (const statement of source.statements) {
    let name
    let members
    if (ts.isInterfaceDeclaration(statement)) {
      if (statement.typeParameters || statement.heritageClauses) continue
      name = statement.name.text
      members = statement.members
    } else if (
      ts.isTypeAliasDeclaration(statement) &&
      ts.isTypeLiteralNode(statement.type) &&
      !statement.typeParameters
    ) {
      name = statement.name.text
      members = statement.type.members
    } else {
      continue
    }

    const shape = canonicalShape(source, members)
    if (!shape) continue
    const location = source.getLineAndCharacterOfPosition(statement.name.getStart(source))
    declarations.push({
      column: location.character + 1,
      concept: conceptName(name),
      line: location.line + 1,
      memberCount: members.length,
      name,
      path: source.fileName,
      propertyKeys: shape.propertyKeys,
      shape: shape.signature,
      system: systemName(source.fileName),
    })
  }
  return declarations
}

function collectSchemaContracts(source) {
  const schemas = []
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const match = /^(.*)Schema$/i.exec(declaration.name.text)
      const properties = findObjectSchemaProperties(declaration.initializer)
      if (!match?.[1] || !properties) continue
      const keys = objectPropertyKeys(properties)
      if (keys) schemas.push({ concept: conceptName(match[1]), keys })
    }
  }
  return schemas
}

function findObjectSchemaProperties(expression) {
  if (!expression) return undefined
  if (ts.isParenthesizedExpression(expression)) {
    return findObjectSchemaProperties(expression.expression)
  }
  if (ts.isCallExpression(expression)) {
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      /^(?:looseObject|object|strictObject|struct)$/i.test(expression.expression.name.text)
    ) {
      const shape = expression.arguments[0]
      return shape && ts.isObjectLiteralExpression(shape) ? shape.properties : undefined
    }
    return findObjectSchemaProperties(expression.expression)
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return findObjectSchemaProperties(expression.expression)
  }
  return undefined
}

function canonicalShape(source, members) {
  if (members.length === 0) return undefined
  const properties = []
  const propertyKeys = []
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type || !member.name) return undefined
    const name = propertyName(member.name)
    if (name === undefined) return undefined
    const readonly = member.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
    )
    const type = member.type.getText(source).replace(/\s+/g, '')
    propertyKeys.push(name)
    properties.push(
      `${readonly ? 'readonly:' : ''}${name}${member.questionToken ? '?' : ''}:${type}`,
    )
  }
  return {
    propertyKeys: propertyKeys.sort().join(';'),
    signature: properties.sort().join(';'),
  }
}

function findSchemaDuplicates(declarations, schemasBySystem) {
  return declarations
    .filter((declaration) =>
      schemasBySystem
        .get(declaration.system)
        ?.has(`${declaration.concept}\0${declaration.propertyKeys}`),
    )
    .map((declaration) => ({
      ...locationOf(declaration),
      code: 'manual-schema-type',
      message: `${declaration.name} repeats a same-named schema contract. Infer the type from the schema.`,
    }))
}

function findRepeatedDeclarations(declarations) {
  const groups = groupBy(
    declarations.filter((declaration) => declaration.memberCount >= 2),
    (declaration) => `${declaration.system}\0${declaration.shape}`,
  )
  const violations = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const concepts = groupBy(group, (declaration) => declaration.concept)
    for (const repeated of concepts.values()) {
      if (repeated.length < 2) continue
      const names = repeated.map((declaration) => declaration.name).join(', ')
      violations.push({
        ...locationOf(repeated[1]),
        code: 'repeated-domain-type',
        message: `Repeated DTO/domain shape (${names}). Export or infer one contract instead.`,
      })
    }
  }
  return violations
}

function hasUnknownExplanation(source, node) {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source))
  const lines = source.text.split(/\r?\n/)
  return UNKNOWN_EXPLANATION.test(
    [lines[location.line - 1] ?? '', lines[location.line] ?? ''].join('\n'),
  )
}

function atNode(source, node, code, message) {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source))
  return {
    code,
    column: location.character + 1,
    line: location.line + 1,
    message,
    path: source.fileName,
  }
}

function locationOf(declaration) {
  const { column, line, path } = declaration
  return { column, line, path }
}

function conceptName(name) {
  let concept = name
  while (TRANSPORT_SUFFIX.test(concept)) concept = concept.replace(TRANSPORT_SUFFIX, '')
  return concept.toLowerCase()
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function objectPropertyKeys(properties) {
  const keys = []
  for (const property of properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return undefined
    }
    const name = propertyName(property.name)
    if (name === undefined) return undefined
    keys.push(name)
  }
  return keys.sort().join(';')
}

function scriptKind(path) {
  return extname(path).toLowerCase() === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function systemName(path) {
  return path.replaceAll('\\', '/').split('/')[1] ?? ''
}

function groupBy(values, getKey) {
  const groups = new Map()
  for (const value of values) {
    const key = getKey(value)
    const group = groups.get(key) ?? []
    group.push(value)
    groups.set(key, group)
  }
  return groups
}
