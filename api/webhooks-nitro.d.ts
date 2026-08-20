import { d as AnyWebhookResource, u as WizardHTTP, wt as AnyHTTPResource } from "./http-options-N-b_EYFt.js";
import { NitroConfig, NitroOpenAPIConfig } from "nitro/types";
//#region src/nitro.d.ts
/** Options for generated Nitro HTTP handlers and API documentation. @public */
interface NitroAPIOptions {
  readonly resources: readonly AnyHTTPResource[];
  /** Module that exports the same resource collection passed to `resources`. */
  readonly resourceModule: string | URL;
  /** Named module export containing the collection. Defaults to `resources`. */
  readonly exportName?: string;
  /** Nitro OpenAPI overrides. Pass `false` to disable generated API docs. */
  readonly openAPI?: false | NitroOpenAPIConfig;
  /** Generated handler cache. Defaults to `.nitro/openwizard-api`. */
  readonly generatedDir?: string;
}
/** Options for generated Nitro webhook handlers and API documentation. @public */
interface NitroWebhookOptions {
  readonly resources: readonly AnyWebhookResource[];
  /** Module that exports the same resource collection passed to `resources`. */
  readonly resourceModule: string | URL;
  /** Named module export containing the collection. Defaults to `webhooks`. */
  readonly exportName?: string;
  /** Nitro OpenAPI overrides. Pass `false` to disable generated API docs. */
  readonly openAPI?: false | NitroOpenAPIConfig;
  /** Generated handler cache. Defaults to `.nitro/openwizard-webhooks`. */
  readonly generatedDir?: string;
}
/** Options for mounting generated OpenWizard HTTP routes in Nitro. @public */
interface NitroOptions extends Omit<NitroAPIOptions, 'resources' | 'resourceModule' | 'exportName'> {
  /** Registry returned by `createHTTP`. */
  readonly http: WizardHTTP;
  /** Module that exports `http`, normally `new URL('./server/http.ts', import.meta.url)`. */
  readonly source: string | URL;
}
/**
 * Add generated POST routes and OpenAPI operations for a collection of webhook resources.
 * @public
 */
declare function withNitroWebhooks(config: NitroConfig, options: NitroWebhookOptions): NitroConfig;
/** Add generated Nitro routes and OpenAPI operations for mixed OpenWizard HTTP resources. @public */
declare function withNitroAPI(config: NitroConfig, options: NitroAPIOptions): NitroConfig;
/** Mount generated OpenWizard routes and their OpenAPI document in Nitro. @public */
declare function withNitro(config: NitroConfig, options: NitroOptions): NitroConfig;
//#endregion
export { NitroAPIOptions, NitroOptions, NitroWebhookOptions, withNitro, withNitroAPI, withNitroWebhooks };
//# sourceMappingURL=nitro.d.ts.map