# @makerspace/pi-defaults

Starter Pi package for Makerspace sessions.

It bundles:

- `extensions/makerspace-defaults.ts` — appends Makerspace product rules and registers `inference/nvidia/nemotron3-super` without editing user dotfiles.
- `skills/` — optional workflow skills, including `code-simplifier`, `playground`, `excalidraw-diagram`, Ponytail helpers, and `emil-design-eng`.
- `prompts/` — slash prompt templates.

The bundled `excalidraw-diagram` skill includes reference scripts/templates, but not local `.venv`, `.git`, or cache folders.
- `context/` — source text used by the extension.

## Local install

```bash
pi install ./packages/makerspace-pi-defaults
```

## Runtime use in Makerspace

Makerspace loads this package as additional Pi resource paths when the package directory exists. Remote bridge sandboxes load the baked copy at:

```text
/home/daytona/.pi/agent/makerspace-pi-defaults
```

Override the local package dir with `MAKERSPACE_PI_DEFAULTS_PACKAGE_DIR`.
Override the remote baked path with `REMOTE_PI_DEFAULTS_PACKAGE_DIR`.

Set `INFERENCE_API_KEY` to use the bundled Inference.net provider.

When this is published, the same package can be installed with:

```bash
pi install npm:@makerspace/pi-defaults@0.1.0
```
