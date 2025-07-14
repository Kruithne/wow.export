## Developing wow.export

> [!CAUTION]
> 💀 This document is intended for people who wish to build wow.export locally or contribute to the project. It is expected that you have the necessary programming experience to do so.

## Pre-Requisites

| Dep | Min Ver | URL |
| --- | --- | --- |
| dotnet | 8.0.0 | https://dotnet.microsoft.com/en-us/ |
| bun | 1.2.15 | https://bun.sh/ |

## Setup

```bash
git clone https://github.com/Kruithne/wow.export.git
cd wow.export
bun install
```

## Development

```bash
# build core+cli (debug) and launch cli
bun debug_cli

# build core (debug) and launch gui
bun debug_gui
```

## Building

Running all build scripts will produce a final output in `/dist/out` for the current platform. Cross-compilation is not supported.

```bash
# build cli (executable)
bun build_cli

# build core (dynamic library)
bun build_core

# build gui (electron application)
bun build_gui
```