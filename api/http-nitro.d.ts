import { NitroConfig, NitroOpenAPIConfig } from "nitro/types";
//#region src/openapi-types.d.ts
/** A JSON Schema (draft 2020-12, the OpenAPI 3.1 dialect) object. @public */
type JSONSchema = {
  readonly [keyword: string]: unknown;
};
/** An OpenAPI 3.1 operation object as generated for one route or outbound callback. @public */
interface OpenAPIOperation {
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly parameters?: readonly JSONSchema[];
  readonly requestBody?: JSONSchema;
  readonly responses: {
    readonly [status: string]: JSONSchema;
  };
  readonly security?: readonly {
    readonly [scheme: string]: readonly string[];
  }[];
  /** Fern SDK namespace, dot-separated (`checkout.runs`). Forge and Fern group methods by it. */
  readonly 'x-fern-sdk-group-name': string;
  /** Fern SDK method name inside its group (`get`, `create`, `sendPaymentCaptured`). */
  readonly 'x-fern-sdk-method-name': string;
  readonly [extension: `x-${string}`]: unknown;
}
/** An OpenAPI tag with its description. @public */
interface OpenAPITag {
  readonly name: string;
  readonly description?: string;
}
/**
 * Components, outbound callbacks and tags contributed by one HTTP source. Names are global in
 * the document: equal definitions merge, different definitions under one name are an error.
 * @public
 */
interface OpenAPIContribution {
  readonly schemas: {
    readonly [name: string]: JSONSchema;
  };
  readonly securitySchemes: {
    readonly [name: string]: JSONSchema;
  };
  /** OpenAPI 3.1 `webhooks`: outbound callbacks this API sends to subscribers. */
  readonly webhooks: {
    readonly [name: string]: {
      readonly post: OpenAPIOperation;
    };
  };
  readonly tags: readonly OpenAPITag[];
}
/** Document-level metadata passed to `createOpenAPIDocument` / `http.openAPI`. @public */
interface OpenAPIInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly servers?: readonly {
    readonly url: string;
    readonly description?: string;
  }[];
}
/** A complete OpenAPI 3.1 document. @public */
interface OpenAPIDocument {
  readonly openapi: '3.1.0';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers?: readonly {
    readonly url: string;
    readonly description?: string;
  }[];
  readonly tags: readonly OpenAPITag[];
  readonly paths: {
    readonly [path: string]: {
      readonly [method: string]: OpenAPIOperation;
    };
  };
  readonly webhooks?: {
    readonly [name: string]: {
      readonly post: OpenAPIOperation;
    };
  };
  readonly components: {
    readonly schemas: {
      readonly [name: string]: JSONSchema;
    };
    readonly securitySchemes?: {
      readonly [name: string]: JSONSchema;
    };
  };
}
//#endregion
//#region src/http.d.ts
/** HTTP methods used by generated OpenWizard routes. @public */
type HTTPResourceMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST';
/**
 * One generated route: a framework-neutral handler plus its OpenAPI operation.
 * `path` uses `:name` parameters; the OpenAPI path is derived from it. A route without
 * `openAPI` is served but left out of the document (the Mirror wire POST).
 * @public
 */
interface AnyHTTPResource {
  readonly id: string;
  readonly method: HTTPResourceMethod;
  readonly path: string;
  readonly openAPI?: OpenAPIOperation;
  handle(request: Request): Promise<Response>;
}
/**
 * Routes plus the OpenAPI components they reference: what `createHTTP` and
 * `createWebhookSubscriptions` return, and what `combineHTTP` composes.
 * @public
 */
interface HTTPSource {
  readonly resources: readonly AnyHTTPResource[];
  readonly openAPIComponents: OpenAPIContribution;
}
/**
 * A servable set of routes. `fetch` routes a request (JSON 404/405 otherwise, OPTIONS answered
 * for CORS preflight); `openAPI` returns the OpenAPI 3.1 document of every documented route.
 * @public
 */
interface HTTPHandler extends HTTPSource {
  fetch(request: Request): Promise<Response>;
  openAPI(info: OpenAPIInfo): OpenAPIDocument;
}
//#endregion
//#region src/nitro.d.ts
/** Options of `withNitro`. @public */
interface NitroOptions {
  /** The handler returned by `createHTTP` or `combineHTTP`. */
  readonly http: HTTPHandler;
  /** Module that exports `http`, normally `new URL('./server/http.ts', import.meta.url)`. */
  readonly source: string | URL;
  /** Named export of `http` in `source`. Defaults to `http`. */
  readonly exportName?: string;
  /** Document and UI routes; `meta` titles the document. Pass `false` to serve no documentation. */
  readonly openAPI?: false | NitroOpenAPIConfig;
  /** Generated handler cache. Defaults to `.nitro/openwizard-http`. */
  readonly generatedDir?: string;
}
/**
 * Add one Nitro route per generated path (every method goes to `http.fetch`, which answers
 * 405s and CORS preflights itself) plus the OpenAPI document, Scalar and Swagger routes.
 * @public
 */
declare function withNitro(config: NitroConfig, options: NitroOptions): NitroConfig;
//#endregion
export { NitroOptions, withNitro };
//# sourceMappingURL=nitro.d.ts.map