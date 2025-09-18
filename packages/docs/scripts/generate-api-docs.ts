#!/usr/bin/env tsx
/**
 * API Documentation Generator
 * Automatically extracts API surface from source code and generates documentation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

interface APIItem {
  name: string;
  kind: string;
  signature: string;
  description?: string;
  parameters?: Array<{
    name: string;
    type: string;
    description?: string;
    optional?: boolean;
  }>;
  returns?: {
    type: string;
    description?: string;
  };
  properties?: Array<{
    name: string;
    type: string;
    optional?: boolean;
    description?: string;
  }>;
}

class APIDocGenerator {
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private apiItems: Map<string, APIItem[]> = new Map();

  constructor(private rootDir: string) {
    const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) throw new Error('tsconfig.json not found');

    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    const { options, fileNames } = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      path.dirname(configPath)
    );

    this.program = ts.createProgram(fileNames, options);
    this.checker = this.program.getTypeChecker();
  }

  generateDocs(packageName: string, entryFile: string): string {
    const sourceFile = this.program.getSourceFile(entryFile);
    if (!sourceFile) throw new Error(`Entry file not found: ${entryFile}`);

    this.extractExports(sourceFile, packageName);
    return this.formatMarkdown(packageName);
  }

  private extractExports(sourceFile: ts.SourceFile, packageName: string) {
    const items: APIItem[] = [];

    ts.forEachChild(sourceFile, (node) => {
      if (ts.isExportDeclaration(node)) {
        this.processExportDeclaration(node, items);
      } else if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        this.processFunctionDeclaration(node, items);
      } else if (ts.isTypeAliasDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        this.processTypeAlias(node, items);
      } else if (ts.isInterfaceDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        this.processInterface(node, items);
      }
    });

    this.apiItems.set(packageName, items);
  }

  private processExportDeclaration(node: ts.ExportDeclaration, items: APIItem[]) {
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const modulePath = node.moduleSpecifier.text;

      if (modulePath.startsWith('./')) {
        const resolvedPath = path.resolve(
          path.dirname(node.getSourceFile().fileName),
          modulePath + '.ts'
        );

        const moduleSource = this.program.getSourceFile(resolvedPath);
        if (moduleSource) {
          this.extractExports(moduleSource, path.basename(modulePath));
        }
      }
    }
  }

  private processFunctionDeclaration(node: ts.FunctionDeclaration, items: APIItem[]) {
    if (!node.name) return;

    const symbol = this.checker.getSymbolAtLocation(node.name);
    if (!symbol) return;

    const type = this.checker.getTypeOfSymbolAtLocation(symbol, node);
    const signature = this.checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0];

    if (!signature) return;

    const params = signature.getParameters().map(param => ({
      name: param.getName(),
      type: this.checker.typeToString(this.checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration!)),
      optional: param.valueDeclaration ? this.isOptional(param.valueDeclaration) : false,
      description: this.getJSDocComment(param.valueDeclaration)
    }));

    const returnType = signature.getReturnType();

    items.push({
      name: node.name.text,
      kind: 'function',
      signature: this.checker.signatureToString(signature),
      description: this.getJSDocComment(node),
      parameters: params,
      returns: {
        type: this.checker.typeToString(returnType),
        description: this.getJSDocReturnComment(node)
      }
    });
  }

  private processTypeAlias(node: ts.TypeAliasDeclaration, items: APIItem[]) {
    const type = this.checker.getTypeAtLocation(node);

    items.push({
      name: node.name.text,
      kind: 'type',
      signature: this.checker.typeToString(type),
      description: this.getJSDocComment(node),
      properties: this.extractTypeProperties(type)
    });
  }

  private processInterface(node: ts.InterfaceDeclaration, items: APIItem[]) {
    const type = this.checker.getTypeAtLocation(node);

    items.push({
      name: node.name.text,
      kind: 'interface',
      signature: node.getText(),
      description: this.getJSDocComment(node),
      properties: this.extractTypeProperties(type)
    });
  }

  private extractTypeProperties(type: ts.Type): APIItem['properties'] {
    const properties: APIItem['properties'] = [];

    for (const symbol of type.getProperties()) {
      const propType = this.checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!);

      properties.push({
        name: symbol.getName(),
        type: this.checker.typeToString(propType),
        optional: symbol.valueDeclaration ? this.isOptional(symbol.valueDeclaration) : false,
        description: this.getJSDocComment(symbol.valueDeclaration)
      });
    }

    return properties;
  }

  private isOptional(node: ts.Node): boolean {
    return node && ts.isPropertySignature(node) && !!node.questionToken;
  }

  private getJSDocComment(node: ts.Node | undefined): string | undefined {
    if (!node) return undefined;

    const jsDocs = (node as any).jsDoc;
    if (jsDocs && jsDocs.length > 0) {
      return jsDocs[0].comment || undefined;
    }
    return undefined;
  }

  private getJSDocReturnComment(node: ts.Node): string | undefined {
    const jsDocs = (node as any).jsDoc;
    if (jsDocs && jsDocs.length > 0) {
      const tags = jsDocs[0].tags;
      if (tags) {
        const returnTag = tags.find((t: any) => t.tagName && t.tagName.text === 'returns');
        if (returnTag && returnTag.comment) {
          return returnTag.comment;
        }
      }
    }
    return undefined;
  }

  private formatMarkdown(packageName: string): string {
    const items = this.apiItems.get(packageName) || [];
    let md = `# ${packageName} API Reference\n\n`;
    md += `> Auto-generated on ${new Date().toISOString()}\n\n`;

    // Group by kind
    const grouped = items.reduce((acc, item) => {
      if (!acc[item.kind]) acc[item.kind] = [];
      acc[item.kind].push(item);
      return acc;
    }, {} as Record<string, APIItem[]>);

    // Functions
    if (grouped.function) {
      md += '## Functions\n\n';
      for (const func of grouped.function) {
        md += this.formatFunction(func);
      }
    }

    // Types
    if (grouped.type) {
      md += '## Types\n\n';
      for (const type of grouped.type) {
        md += this.formatType(type);
      }
    }

    // Interfaces
    if (grouped.interface) {
      md += '## Interfaces\n\n';
      for (const iface of grouped.interface) {
        md += this.formatInterface(iface);
      }
    }

    return md;
  }

  private formatFunction(func: APIItem): string {
    let md = `### \`${func.name}\`\n\n`;

    if (func.description) {
      md += `${func.description}\n\n`;
    }

    md += '```typescript\n';
    md += func.signature + '\n';
    md += '```\n\n';

    if (func.parameters && func.parameters.length > 0) {
      md += '**Parameters:**\n\n';
      for (const param of func.parameters) {
        md += `- \`${param.name}\` (\`${param.type}\`)${param.optional ? ' _optional_' : ''}`;
        if (param.description) {
          md += ` - ${param.description}`;
        }
        md += '\n';
      }
      md += '\n';
    }

    if (func.returns) {
      md += `**Returns:** \`${func.returns.type}\``;
      if (func.returns.description) {
        md += ` - ${func.returns.description}`;
      }
      md += '\n\n';
    }

    return md;
  }

  private formatType(type: APIItem): string {
    let md = `### \`${type.name}\`\n\n`;

    if (type.description) {
      md += `${type.description}\n\n`;
    }

    md += '```typescript\n';
    md += `type ${type.name} = ${type.signature}\n`;
    md += '```\n\n';

    if (type.properties && type.properties.length > 0) {
      md += '**Properties:**\n\n';
      for (const prop of type.properties) {
        md += `- \`${prop.name}\` (\`${prop.type}\`)${prop.optional ? ' _optional_' : ''}`;
        if (prop.description) {
          md += ` - ${prop.description}`;
        }
        md += '\n';
      }
      md += '\n';
    }

    return md;
  }

  private formatInterface(iface: APIItem): string {
    let md = `### \`${iface.name}\`\n\n`;

    if (iface.description) {
      md += `${iface.description}\n\n`;
    }

    if (iface.properties && iface.properties.length > 0) {
      md += '**Properties:**\n\n';
      md += '| Property | Type | Required | Description |\n';
      md += '|----------|------|----------|-------------|\n';

      for (const prop of iface.properties) {
        md += `| \`${prop.name}\` | \`${prop.type}\` | ${prop.optional ? 'No' : 'Yes'} | ${prop.description || '-'} |\n`;
      }
      md += '\n';
    }

    return md;
  }
}

// Generate documentation
async function main() {
  const rootDir = path.resolve(__dirname, '../..');

  // Generate core API docs
  const coreGenerator = new APIDocGenerator(path.join(rootDir, 'core'));
  const coreDocs = coreGenerator.generateDocs(
    '@wizard/core',
    path.join(rootDir, 'core/src/index.ts')
  );

  fs.writeFileSync(
    path.join(rootDir, 'docs/pages/api/core.mdx'),
    coreDocs
  );

  // Generate React API docs
  const reactGenerator = new APIDocGenerator(path.join(rootDir, 'react'));
  const reactDocs = reactGenerator.generateDocs(
    '@wizard/react',
    path.join(rootDir, 'react/src/index.ts')
  );

  fs.writeFileSync(
    path.join(rootDir, 'docs/pages/api/react.mdx'),
    reactDocs
  );

  console.log('✅ API documentation generated successfully!');
}

main().catch(console.error);