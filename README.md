# wow.export
wow.export is a node-webkit port of [Marlamin's](https://github.com/Marlamin) [WoW Export Tools](https://github.com/Marlamin/WoWExportTools/) which provides tools for extracting and converting files from the World of Warcraft game client or public CDN servers.

## Features
- Cross-platform support for Windows, MacOS and Linux.

## Installing
To install wow.export, navigate to the ['Releases'](https://github.com/Kruithne/wow.export/releases) page and download the latest one for your operating system. That's it!

## Building (Developers Only)
> Note: Building wow.export from the source code is only intended for development purposes. Unless you are planning to contribute to or fork the codebase, check the 'Installing' step instead.

> Note: Building wow.export **requires** Node 12.12.0 or above.

```
git fetch https://github.com/Kruithne/wow.export.git
npm install

# This will list available builds.
node ./build.js

# Substitute <BUILD> for the build(s) you wish to compile, space-delimitated.
node ./build.js <BUILD>
```