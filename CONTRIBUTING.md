## Contributing

Contributions to wow.export are welcome, please file a pull-request with adequate details.

Pull-requests are expected to be complete. If a pull-request requires significant work by a maintainer to merge then it will be rejected - consider making a feature suggestion instead!

> [!IMPORTANT] Pull-requests that add third-party libraries, use external services or adjust the build pipeline without first consulting the #wow-export-dev channel will be rejected.

Development of wow.export is actively discussed in [#wow-export-dev](https://discord.gg/kC3EzAYBtf). While participation is not mandatory for pull-requests, those wishing to contribute frequently are expected to be present.

If you plan to make a large contribution, it is expected that you would open a self-assigned tracking issue and co-ordinate with the active maintainers before starting.

Open-issues that have an assignee and are not listed as "Backlog" on the roadmap are currently championed by a maintainer. Contributors should not target these issues.

## Roadmap

The developers maintain a [public roadmap](https://github.com/users/Kruithne/projects/1/views/9) to help give insight and organization to the development process. Before contributing, it's recommended to consult this.

## Building (Developers Only)

### Prerequisites
- **Bun** 1.2 or above (required)
- **Node.js** v24.9.0 or above (required for native add-ons)
- **Python 2.7.18** (required for node-gyp)
  - Windows: Install via `choco install python2 -y`
  - macOS: Install via pyenv: `pyenv install 2.7.18`
  - Linux: Install via apt: `sudo apt install python2 python2-dev`
- **nw-gyp** (required for building native add-ons): `npm install -g nw-gyp@latest`
- **Build tools** (platform-specific):
  - Windows: Visual Studio Build Tools with C++ support
  - Linux: `build-essential` package (`sudo apt-get install build-essential`)
  - macOS: Xcode Command Line Tools

### Build Steps
```
git clone https://github.com/Kruithne/wow.export.git
cd wow.export
bun install

# This will list available builds.
bun ./build.js

# This will compile -all- available builds.
bun ./build.js *

# Substitute <BUILD> for the build(s) you wish to compile, space-delimitated.
bun ./build.js <BUILD1> <BUILD2> ...
```

**Note**: The build process will automatically download nw.js headers and handle native add-on compilation if any are present in the `node_addons/` directory.

## Debugging (Developers Only)
> **Note**: Debugging is currently only supported on Windows.

To debug wow.export, compile a `win-x64-debug` build using the build script. This will produce a bare-bones build using the SDK framework and without any production polish. Upon starting the debug version, DevTools will be automatically launched alongside the application.

For the debug build, source code will not be compiled, rather a symlink is created. This means changes to the source code are instantly reflected in the application, simply run `chrome.runtime.reload()` in DevTools console to refresh sources (pressing F5 does not drop references and will lead to memory leaks).