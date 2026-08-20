# ADR-002: Nitro builds deployment artifacts; infrastructure remains an adapter

- Status: accepted
- Date: 2026-08-18

## Context

OpenWizard can run in Node, an edge worker, or a serverless function, but those hosts require
different entrypoints and metadata. An infrastructure tool can create cloud resources, yet it
does not give the application one portable build process. Making one cloud or infrastructure
tool part of the runtime would also conflict with the storage and provider boundaries.

## Decision

Use Nitro 3 as the documented host and artifact builder:

- Application source uses OpenWizard and standard web request APIs.
- CI selects a Nitro preset and receives a target-specific artifact.
- The checked example builds Node/container, AWS Lambda, Azure Static Web Apps, Firebase App
  Hosting, Cloudflare Workers, Vercel, and Netlify artifacts from the same source.
- SST, Pulumi, Terraform, provider CI, or another infrastructure tool may deploy that artifact
  and bind provider resources.
- Published OpenWizard packages do not depend on Nitro or an infrastructure framework.
- Database connections, queues, secrets, migrations, and durable storage implementations remain
  application-owned adapters.

Nitro 3 is currently a beta dependency, so the example pins an exact version. The integration
stays in an example and documentation until Nitro 3 has a stable release and an OpenWizard
package would remove enough repeated code to justify its public API.

## Consequences

- One HTTP host can produce the formats expected by the main cloud and application platforms.
- Choosing Pulumi does not force it on SST users, and choosing Drizzle does not force a database.
- Build and provisioning can change independently.
- Platform bindings still need a small application adapter because their APIs are genuinely
  different.
- The Nitro beta must be upgraded deliberately and all checked target builds must pass before
  its version changes.
