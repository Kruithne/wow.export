# 📦 wow.export
wow.export is a node-webkit port of [Marlamin's](https://github.com/Marlamin) [WoW Export Tools](https://github.com/Marlamin/WoWExportTools/) which provides tools for extracting and converting files from the World of Warcraft game client or public CDN servers.

## Features
- Soon™

## Installing
To install wow.export, navigate to the ['Releases'](https://github.com/Kruithne/wow.export/releases) page and download the latest version. That's it!

> **OSX/Linux**: For people not using Windows, we are currently not producing builds targeted for these platforms. You will need to make use of Wine to use wow.export for now or compile your own build.

## Building (Developers Only)
- 🔨 Building wow.export **requires** Node 12.12.0 or above.
- 🧙‍ For building on Windows, [node-gyp prerequisites](https://github.com/nodejs/node-gyp#on-windows) **may** be required.
- 🍷 For building on platforms **other** than Windows, Wine 1.6 or above is required.

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