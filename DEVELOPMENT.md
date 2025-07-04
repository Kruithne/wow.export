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

## Development Build
### CLI

```bash
cd cli
dotnet build # build CLI executable (required for GUI)
dotnet run # build CLI and run directly
```

### GUI

```bash
# adjust platform/arch as needed
bunx electron-packager ./app wow_export --platform=win32 --arch=x64 --out=dist/ --overwrite
```