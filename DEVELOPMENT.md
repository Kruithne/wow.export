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

# install project dependencies
cd wow.export
bun install

# install gui dependencies
cd gui
bun install
```

## Development

```bash
# build core+cli (debug) and launch cli
bun debug_cli

# build core (debug) and launch gui
bun debug_gui

# tail runtime.log from app data
bun tail_runtime_log
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

## Inter-Process Communication (IPC)

The application uses a protobuf-based IPC system for communication between components:

The system uses a length-prefixed binary protocol where each message consists of a 4-byte length header followed by a protobuf-encoded payload. Messages are defined in `/proto/messages.proto` and automatically compiled for both C# (.NET) and JavaScript environments.

For detailed technical documentation, see [docs/IPC.md](docs/IPC.md).