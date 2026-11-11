/** A JSON Schema (draft 2020-12, the OpenAPI 3.1 dialect) object. @public */
export type JSONSchema = { readonly [keyword: string]: unknown }

/** An OpenAPI 3.1 operation object as generated for one route or outbound callback. @public */
export interface OpenAPIOperation {
  readonly operationId: string
  readonly summary: string
  readonly description: string
  readonly tags: readonly string[]
  readonly parameters?: readonly JSONSchema[]
  readonly requestBody?: JSONSchema
  readonly responses: { readonly [status: string]: JSONSchema }
  readonly security?: readonly { readonly [scheme: string]: readonly string[] }[]
  /** Fern SDK namespace, dot-separated (`checkout.runs`). Forge and Fern group methods by it. */
  readonly 'x-fern-sdk-group-name': string
  /** Fern SDK method name inside its group (`get`, `create`, `sendPaymentCaptured`). */
  readonly 'x-fern-sdk-method-name': string
  readonly [extension: `x-${string}`]: unknown
}

/** An OpenAPI tag with its description. @public */
export interface OpenAPITag {
  readonly name: string
  readonly description?: string
}

/**
 * Components, outbound callbacks and tags contributed by one HTTP source. Names are global in
 * the document: equal definitions merge, different definitions under one name are an error.
 * @public
 */
export interface OpenAPIContribution {
  readonly schemas: { readonly [name: string]: JSONSchema }
  readonly securitySchemes: { readonly [name: string]: JSONSchema }
  /** OpenAPI 3.1 `webhooks`: outbound callbacks this API sends to subscribers. */
  readonly webhooks: { readonly [name: string]: { readonly post: OpenAPIOperation } }
  readonly tags: readonly OpenAPITag[]
}

/** Document-level metadata passed to `createOpenAPIDocument` / `http.openAPI`. @public */
export interface OpenAPIInfo {
  readonly title: string
  readonly version: string
  readonly description?: string
  readonly servers?: readonly { readonly url: string; readonly description?: string }[]
}

/** A complete OpenAPI 3.1 document. @public */
export interface OpenAPIDocument {
  readonly openapi: '3.1.0'
  readonly info: { readonly title: string; readonly version: string; readonly description?: string }
  readonly servers?: readonly { readonly url: string; readonly description?: string }[]
  readonly tags: readonly OpenAPITag[]
  readonly paths: { readonly [path: string]: { readonly [method: string]: OpenAPIOperation } }
  readonly webhooks?: { readonly [name: string]: { readonly post: OpenAPIOperation } }
  readonly components: {
    readonly schemas: { readonly [name: string]: JSONSchema }
    readonly securitySchemes?: { readonly [name: string]: JSONSchema }
  }
}
