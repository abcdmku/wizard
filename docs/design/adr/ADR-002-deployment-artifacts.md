# ADR-002: Nitro builds deployment artifacts, infrastructure remains an adapter

- Status: accepted
- Date: 2026-08-18

## Context

OpenWizard runs in Node, edge workers, and serverless functions, whose entrypoints and metadata differ. An infrastructure tool can provision resources, but the application still needs a build process for its target. Core should not depend on a cloud provider or infrastructure framework.

## Decision

Use Nitro 3 as the documented host and artifact builder:

- Application source uses OpenWizard and standard web request APIs.
- CI chooses a Nitro preset and produces a target-specific artifact.
- The deployment example builds Node/container, AWS Lambda, Azure Static Web Apps, Firebase App Hosting, Cloudflare Workers, Vercel, and Netlify artifacts from the same source.
- SST, Pulumi, Terraform, or provider CI can deploy the artifact and bind resources.
- Database connections, queues, secrets, migrations, and storage implementations remain application-owned adapters.

The initial decision kept integration in an example until repeated hosting glue justified a package. That extraction now lives in `@openwizard/http/nitro`, with Nitro as an optional peer. Core remains independent of Nitro. The HTTP implementation uses the framework-neutral `createHTTP(wizard, options)` fetch handler; the Nitro entry adapts hosting configuration.

The repository pins a Nitro beta for checked deployment examples. Upgrade that pin deliberately and rerun the target builds when it changes.

## Consequences

One application source can build for several hosts. Artifact construction and resource provisioning can change independently, so choosing one infrastructure tool does not impose it on other users.

Provider bindings still need application adapters because database, queue, and secret APIs differ. The optional Nitro integration does not take ownership of those resources.
