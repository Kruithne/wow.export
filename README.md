# 📦 wow.export ![Build Status](https://travis-ci.org/Kruithne/wow.export.svg?branch=master)
wow.export is a node-webkit port of [Marlamin's](https://github.com/Marlamin) [WoW Export Tools](https://github.com/Marlamin/WoWExportTools/) which provides tools for extracting and converting files from the World of Warcraft game client or public CDN servers.

## Features
- Supports both Retail and Classic game clients.
- Complete online support allowing streaming of all files without a client.
- Full 3D preview of both M2 and WMO (doodads included) game models.
- Export into a variety of formats (with more coming soon).
- Overhead map viewer with easy exporting of terrain, textures and objects.
- Includes Blender add-on for advanced map/model importing.
- Preview and export all sound files from the game client.
- Export all video files (cinematics) from the game client.
- Locale support for all 13 languages supported by the client.
- Convert local M2/BLP files by drag-dropping them onto the application.

## Installing
To install wow.export, navigate to the [site](https://www.kruithne.net/wow.export/) and download the latest version. That's it!

> **OSX/Linux**: We are currently not producing builds targeted for non-Windows builds. If you wish to use wow.export on OSX or Linux, you will need to compile your own build from the source. See GH-1 for known issues.

## Updating
When an update to wow.export is available, you will be prompted in the application to update. This process is done entirely automatically once you accept the update!

## Building (Developers Only)
- 🔨 Building wow.export **requires** Node 15.3.0 or above.
- 🔨 Building wow.export **requires** Bun 1.2 or above.

```
git fetch https://github.com/Kruithne/wow.export.git
npm install

# This will list available builds.
node ./build.js

# This will compile -all- available builds.
node ./build.js *

# Substitute <BUILD> for the build(s) you wish to compile, space-delimitated.
node ./build.js <BUILD1> <BUILD2> ...
```

## Debugging (Developers Only)
> **Note**: Debugging is currently only supported on Windows.

To debug wow.export, compile a `win-x64-debug` build using the build script. This will produce a bare-bones build using the SDK framework and without any production polish. Upon starting the debug version, DevTools will be automatically launched alongside the application.

For the debug build, source code will not be compiled, rather a symlink is created. This means changes to the source code are instantly reflected in the application, simply run `chrome.runtime.reload()` in DevTools console to refresh sources (pressing F5 does not drop references and will lead to memory leaks).

To quickly launch the debug build from the project directory, run `node debug` from your terminal. This will also handle compilation of `.scss` files both on startup and when changes are detected (allowing styling to be hot-reloaded via DevTools).
