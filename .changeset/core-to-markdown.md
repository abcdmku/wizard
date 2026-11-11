---
'@openwizard/core': minor
---

Add `toMarkdown(inspect(wizard))` to `@openwizard/core/inspect`. It renders the manifest as one
page: the Mermaid diagram, a table of when each step starts, what it does and where it leads,
each step's typed needs, guard, retry, timeout, undo hook and schemas, then the context fields,
events and warnings. The output is deterministic, so a generated page can be committed and
checked for drift.

`defineWizard` options now accept `description` and `meta`. The compiler and the manifest already
carried them for the wizard, but the option type rejected both.

Ship `AGENTS.md` in the package: the authoring model, rules and a tested example for coding
agents. Public doc comments no longer name internal constructors or old version numbers, and the
garbled characters in several of them are repaired.
