import type { NitroOpenAPIConfig } from 'nitro/types'

/** A generated Nitro handler module that answers with `html`. */
export function htmlModule(html: string): string {
  return `import { defineHandler } from 'nitro/h3'

const html = ${JSON.stringify(html)}

export default defineHandler(() => new Response(html, {
  headers: { 'content-type': 'text/html; charset=utf-8' },
}))
`
}

/** The Scalar reference page for the document at `documentRoute`. */
export function scalarHTML(openAPI: NitroOpenAPIConfig, documentRoute: string): string {
  const scalar = openAPI.ui?.scalar
  const config = {
    ...(typeof scalar === 'object' && scalar !== null ? scalar : {}),
    url: documentRoute,
    spec: { url: documentRoute },
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHTML(openAPI.meta?.description ?? '')}" />
    <title>${escapeHTML(openAPI.meta?.title ?? 'OpenWizard HTTP API')}</title>
  </head>
  <body>
    <script id="api-reference" data-configuration="${escapeHTML(JSON.stringify(config))}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`
}

/** The Swagger UI page for the document at `documentRoute`. */
export function swaggerHTML(openAPI: NitroOpenAPIConfig, documentRoute: string): string {
  const swagger = openAPI.ui?.swagger
  const config =
    typeof swagger === 'object' && swagger !== null
      ? Object.fromEntries(Object.entries(swagger).filter(([key]) => key !== 'route'))
      : {}
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHTML(openAPI.meta?.description ?? '')}" />
    <title>${escapeHTML(openAPI.meta?.title ?? 'OpenWizard HTTP API')}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@^5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@^5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => SwaggerUIBundle({
        ...${scriptJSON(config)},
        url: ${scriptJSON(documentRoute)},
        dom_id: '#swagger-ui',
      })
    </script>
  </body>
</html>`
}

function scriptJSON(value: unknown): string {
  return JSON.stringify(value).replaceAll('</', '<\\/')
}

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
