# @spanner/pi-defaults

Starter Pi package for Spanner sessions.

It bundles:

- `extensions/spanner-defaults.ts` — appends Spanner product rules without editing user dotfiles.
- `skills/` — optional workflow skills, including `code-simplifier`, `playground`, `excalidraw-diagram`, Ponytail helpers, and `emil-design-eng`.
- `prompts/` — slash prompt templates.

The bundled `excalidraw-diagram` skill includes reference scripts/templates, but not local `.venv`, `.git`, or cache folders.
- `context/` — source text used by the extension.

## Local install

```bash
pi install ./packages/spanner-pi-defaults
```

## Runtime use in Spanner

Spanner loads this package as additional Pi resource paths when the package directory exists. Remote bridge sandboxes load the baked copy at:

```text
/home/daytona/.pi/agent/spanner-pi-defaults
```

Override the local package dir with `SPANNER_PI_DEFAULTS_PACKAGE_DIR`.
Override the remote baked path with `REMOTE_PI_DEFAULTS_PACKAGE_DIR`.


When this is published, the same package can be installed with:

```bash
pi install npm:@spanner/pi-defaults@0.1.0
```
