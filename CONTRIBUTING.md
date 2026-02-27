## Contributing

Contributions to wow.export are welcome, please file a pull-request with adequate details.

Pull-requests are expected to be complete. If a pull-request requires significant work by a maintainer to merge then it will be rejected - consider making a feature suggestion instead!

> [!IMPORTANT] Pull-requests that add third-party libraries, use external services or adjust the build pipeline without first consulting the #wow-export-dev channel will be rejected.

Development of wow.export is actively discussed in [#wow-export-dev](https://discord.gg/kC3EzAYBtf). While participation is not mandatory for pull-requests, those wishing to contribute frequently are expected to be present.

If you plan to make a large contribution, it is expected that you would open a self-assigned tracking issue and co-ordinate with the active maintainers before starting.

Open-issues that have an assignee and are not listed as "Backlog" on the roadmap are currently championed by a maintainer. Contributors should not target these issues.

## Roadmap

The developers maintain a [public roadmap](https://github.com/users/Kruithne/projects/1/views/9) to help give insight and organization to the development process. Before contributing, it's recommended to consult this.

## Architecture Overview

wow.export uses [Electrobun](https://electrobun.dev/) as its application framework, which pairs a Bun process (server-side) with a CEF webview (client-side). The two sides communicate over a binary RPC layer defined in `src/rpc/`.

- **Bun-side** (`src/bun/`) — CASC file system, database access, exports, file I/O, platform APIs.
- **View-side** (`src/js/`, `src/views/`) — Vue 3 application with a tab-based module system, 3D rendering, and UI components.
- **RPC schema** (`src/rpc/schema.js`) — Defines all request/response types between the two sides.

## Building (Developers Only)

### Prerequisites
- **[Bun](https://bun.sh/)** 1.2 or above

No other runtime or build tooling is required. Electrobun and all other dependencies are installed via Bun.

### Setup
```
git clone https://github.com/Kruithne/wow.export.git
cd wow.export
bun install
```

### Development
```
# Start in development mode.
bun run dev

# Start in development mode with live reloading.
bun run dev:watch
```

In development mode, a context menu provides debug utilities including CSS/shader/module hot-reloading and access to the runtime log.

### Production Builds
```
# Build for the stable release channel.
bun run build:stable

# Build for the canary release channel.
bun run build:canary
```

Build output is written to the `build/` directory. Build configuration is defined in `electrobun.config.ts`.
