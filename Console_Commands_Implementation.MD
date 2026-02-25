# Command Line Interface (CLI) Implementation Plan

This document outlines the plan for implementing command-line interface (CLI) capabilities for `wow.export`.

## 1. Objectives
- Allow users to perform exports without interacting with the GUI.
- Support automation and scripting for asset extraction.
- Provide a headless mode for server-side or batch processing.

## 2. Technical Approach

### 2.1 Entry Point Modification
- **Location:** `src/app.js`
- **Action:** Check `nw.App.argv` for CLI-specific flags at the very beginning of the initialization.
- **Logic:** If CLI flags are detected, bypass the standard Vue.js UI mounting and enter a "CLI Mode".

### 2.2 CLI Mode Initialization
In CLI Mode, the following components must be initialized:
1. **Logging:** Initialize the `log` module to output to `stdout/stderr` instead of just the log file.
2. **Configuration:** Load the application configuration using the `config` module. Allow CLI overrides for settings like `exportDirectory`.
3. **CASC/MPQ Source:** Automatically initialize the data source.
    - If a specific build/path is provided via CLI, use it.
    - Otherwise, use the last used source from the configuration.
4. **Mock View:** Create a minimal mock of the `core.view` object to satisfy dependencies in existing modules.
    - Mock functions like `setToast`, `showLoadingScreen`, and `progressLoadingScreen` to print to the console.

### 2.3 Argument Parsing
A basic command structure should be implemented:
```bash
wow.export.exe [command] [options]
```
**Proposed Commands:**
- `export-texture`: Export textures by FileDataID or listfile path.
- `export-model`: Export M2 or WMO models.
- `export-map`: Export ADT/WDT maps.
- `export-data`: Export DB2 tables to CSV/SQL/JSON.
- `list-builds`: List available local and remote CASC builds.

**Proposed Options:**
- `--id <n>`: Specify FileDataID.
- `--name <path>`: Specify listfile path.
- `--out <path>`: Override the default export directory.
- `--format <fmt>`: Override the export format (e.g., PNG, WEBP, OBJ, GLTF).
- `--build <tag>`: Specify the CASC build to use.
- `--quiet`: Suppress non-essential output.

### 2.4 Command Mapping
Map CLI commands to existing logic:
- **Textures:** `src/js/ui/texture-exporter.js` -> `exportFiles()`
- **Models:** `src/js/3D/exporters/` (M2Exporter, WMOExporter, etc.)
- **Maps:** `src/js/3D/exporters/ADTExporter.js`
- **Data:** `src/js/casc/db2.js` and related exporters.

### 2.5 Headless Execution
- Use `win.hide()` (NW.js) immediately if CLI mode is active to prevent the window from appearing.
- Call `process.exit(code)` upon completion or failure.

## 3. Implementation Steps

1. **Step 1: Argument Detection**
    - Implement a basic argument parser in `src/app.js`.
2. **Step 2: Mocking Core**
    - Refactor `core.js` to handle a headless state where `core.view` is not a Vue instance.
3. **Step 3: Source Auto-Selection**
    - Implement logic to select a CASC source without user interaction (e.g., `--local <path>` or `--remote <region>`).
4. **Step 4: Texture CLI**
    - Implement the first CLI command `export-texture` as a proof of concept.
5. **Step 5: Expansion**
    - Implement remaining commands (models, maps, data).
6. **Step 6: Testing & Validation**
    - Verify that CLI commands work as expected and do not break the existing GUI.

## 4. Example Usage
```bash
# Export a specific texture by ID to PNG
wow.export.exe export-texture --id 12345 --format PNG

# Export a character model to glTF
wow.export.exe export-model --name "path/to/model.m2" --format GLTF

# List available remote builds
wow.export.exe list-builds --remote
```

## 5. Potential Challenges
- **NW.js Constraints:** NW.js is primarily a GUI framework; ensuring it behaves correctly in a pure CLI environment (headless) may require specific flags or window management.
- **Dependency on UI State:** Many modules read state directly from `core.view`. A robust mocking strategy is essential.
- **Async Initialization:** CASC initialization is asynchronous and complex (updates, listfile loading). The CLI must wait for these processes before executing commands.
