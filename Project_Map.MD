# Project Map

## File: updater\updater.js
**Description:** Manages the application update process, including checking for new versions, downloading updates from GitHub, installing them, and handling cleanup. It utilizes Electron's `app` and `dialog` modules for user interaction and `fs` for file system operations.

### Functions/Methods:
- `verifyUpdateDir(dir)`: Verifies if the specified directory path is suitable for storing and processing application updates, ensuring necessary permissions and existence.
- `downloadFile(url, dest)`: Downloads a file from a given URL to a specified destination path on the local filesystem.
- `getLatestVersion()`: Retrieves the latest available version information of the application from a remote source, typically for update checks.
- `downloadUpdate(version, onProgress)`: Initiates the download of the update package for a particular application version, with support for reporting download progress.
- `installUpdate(zipPath)`: Installs the application update by extracting contents from the provided ZIP archive to the application directory.
- `cleanUp()`: Removes temporary files and directories created during the update process to ensure a clean state.
- `restartAndInstall()`: Restarts the application to apply the newly installed update, ensuring all changes take effect.
- `start()`: Initializes and starts the update checking and management process for the application.
- `isUpdateRequired(current, latest)`: Compares the current application version with the latest available version to determine if an update is required.
- `on(event, handler)`: Registers an event handler function to be called when a specific update-related event occurs.

## File: trigger_release.js
**Description:** This script handles the automated triggering of application releases. It sends release-related information to a configured webhook, facilitating continuous deployment.

### Functions/Methods:
- No user-defined functions found in this script.

## File: src\js\xml.js
**Description:** This file provides utility functions for parsing XML content, converting XML strings into JavaScript objects for easier manipulation within the application.

### Functions/Methods:
- `parse_xml(xml)`: Parses an XML string and converts it into a JavaScript object structure.
- `skip_whitespace()`: Advances the parsing position past whitespace characters in the XML string.
- `parse_tag_name()`: Extracts the name of an XML tag from the current parsing position.
- `parse_attributes()`: Parses XML attributes from the current position and returns them as an object.
- `parse_node()`: Recursively parses a single XML node, including its tag, attributes, and child nodes.
- `build_object(node)`: Converts a parsed XML node structure into a more easily consumable JavaScript object.
- `export(parse_xml)`: Exports the `parse_xml` function for external use.

## File: src\js\wowhead.js
**Description:** This file contains functions for interacting with Wowhead data, specifically for retrieving item icons and gathering item IDs from Wowhead URLs.

### Functions/Methods:
- `getIcon(id)`: Retrieves an item icon based on its ID from Wowhead.
- `getIcons(ids)`: Retrieves multiple item icons based on their IDs from Wowhead.
- `gatherItemIDs(url)`: Extracts item IDs from a given Wowhead URL.
- `export(getIcon, getIcons, gatherItemIDs)`: Exports functions for retrieving icons and item IDs from Wowhead.

## File: src\js\wow\ItemSlot.js
**Description:** This file defines utility functions related to item slots within the World of Warcraft context, primarily for identifying the slot type of a given item.

### Functions/Methods:
- `getItemSlot(itemID)`: Retrieves the equipment slot for a given item ID.
- `export(getItemSlot)`: Exports the function to get an item's equipment slot.

## File: src\js\wow\EquipmentSlots.js
**Description:** This file provides utilities for managing and converting World of Warcraft equipment slot information, mapping between slot IDs and their corresponding names or enumerations.

### Functions/Methods:
- `getEquipmentSlotName(slotID)`: Retrieves the human-readable name for a given equipment slot ID.
- `getEquipmentSlotEnum(slotName)`: Retrieves the enumeration value for a given equipment slot name.
- `export(getEquipmentSlotName, getEquipmentSlotEnum)`: Exports functions for retrieving equipment slot names and enumerations.

## File: src\js\wmv.js
**Description:** This file likely contains core functionality for handling WMV (World of Warcraft Model Viewer) related operations, such as loading, parsing, and extracting data from WMV files.

### Functions/Methods:
- `WMV(WMV)`: Represents the WMV object or constructor.
- `setVersion(version)`: Sets the version for the WMV data.
- `loadFile(file)`: Loads a WMV file for processing.
- `parse()`: Parses the loaded WMV file content.
- `extractGeoset()`: Extracts geoset data from the WMV.
- `extractTexture()`: Extracts texture data from the WMV.
- `extractParticle()`: Extracts particle system data from the WMV.
- `buildMesh(scene)`: Builds a mesh from the WMV data for rendering in a 3D scene.
- `export(WMV)`: Exports the WMV class/object.

## File: src\js\updater.js
**Description:** This file defines core functionality for the application's auto-update mechanism, handling version checks, downloads, and installations.

### Functions/Methods:
- `verifyUpdateDir(dir)`: Verifies if the specified directory is valid for updates.
- `downloadFile(url, dest)`: Downloads a file from a URL to a specified destination.
- `getLatestVersion()`: Retrieves the latest available version information.
- `downloadUpdate(version, onProgress)`: Downloads a specific version update, providing progress.
- `installUpdate(zipPath)`: Installs the application update from a ZIP file.
- `cleanUp()`: Performs cleanup operations after an update.
- `restartAndInstall()`: Restarts the application to finalize update installation.
- `start()`: Initializes and starts the update process.
- `isUpdateRequired(current, latest)`: Compares two versions to determine if an update is needed.
- `on(event, handler)`: Registers an event handler for updater events.

## File: src\js\ui\uv-drawer.js
**Description:** This file provides functionality for drawing UV (Texture Coordinate) maps, likely used in a 3D model viewing context for debugging or display purposes.

### Functions/Methods:
- `drawUV(vertices, uvs)`: Draws UV coordinates onto a display surface using provided vertices and UV data.
- `export(drawUV)`: Exports the function for drawing UV maps.

## File: src\js\ui\texture-ribbon.js
**Description:** This file manages the user interface component for displaying a ribbon of textures, allowing selection and interaction with individual textures.

### Functions/Methods:
- `initRibbon()`: Initializes the texture ribbon UI component.
- `setSelection(textureID)`: Sets the currently selected texture in the ribbon by its ID.
- `clearRibbon()`: Clears all textures from the ribbon display.
- `addItem(textureID, texture)`: Adds a new texture item to the ribbon display.

## File: src\js\ui\texture-exporter.js
**Description:** This file contains logic for exporting textures from the application, likely handling various formats and output options.

### Functions/Methods:
- `exportTextures()`: Exports selected or all textures managed by the application.
- `export(exportTextures)`: Exports the function for texture export.

## File: src\js\ui\model-viewer-utils.js
**Description:** This file provides utility functions specifically designed to assist with the functionality and setup of the 3D model viewer component.

### Functions/Methods:
- `createTextureRibbon(viewer)`: Creates and integrates a texture ribbon into the model viewer.
- `createModelTextureDisplay(viewer)`: Creates and manages the display of model textures within the viewer.
- `createGeoSetDisplay(viewer)`: Creates and manages the display of geoset information within the model viewer.
- `export(createTextureRibbon, createModelTextureDisplay, createGeoSetDisplay)`: Exports functions for model viewer utility components.

## File: src\js\ui\listbox-context.js
**Description:** This file handles contextual interactions for listbox components, likely managing right-click menus or other context-sensitive actions.

### Functions/Methods:
- `handleListboxContext(listbox, menu)`: Manages and displays the context menu for a given listbox component.
- `export(handleListboxContext)`: Exports the function for handling listbox context menus.

## File: src\js\ui\data-exporter.js
**Description:** This file centralizes functionality for exporting various types of data from the application, including handling directory selection and format conversion.

### Functions/Methods:
- `openExportDirectory(filePath)`: Opens the directory where a file has been exported.
- `exportData()`: Initiates the process of exporting data from the application.
- `export(openExportDirectory, exportData)`: Exports functions for opening export directories and initiating data export.

## File: src\js\ui\char-texture-overlay.js
**Description:** This file manages the display of character texture overlays within a model viewer, possibly for customization or inspection purposes.

### Functions/Methods:
- `enableCharTextureOverlay(viewer)`: Enables or disables the character texture overlay in the specified model viewer.
- `export(enableCharTextureOverlay)`: Exports the function to control character texture overlays.

## File: src\js\ui\audio-helper.js
**Description:** This file provides helper functions for managing audio playback and interaction within the user interface, likely including controls for an audio player.

### Functions/Methods:
- `initAudioPlayer()`: Initializes the audio player component in the UI.
- `openAudioPlayer(files)`: Opens the audio player with a list of audio files.
- `playAudio(audioFile)`: Plays a specific audio file.
- `stopAudio()`: Stops the currently playing audio.
- `export(initAudioPlayer, openAudioPlayer, playAudio, stopAudio)`: Exports functions for managing audio playback in the UI.

## File: src\js\tiled-png-writer.js
**Description:** This file implements a writer for generating tiled PNG images, which can be useful for exporting textures or maps composed of multiple smaller images.

### Functions/Methods:
- `TiledPNGWriter(TiledPNGWriter)`: Constructor for a Tiled PNG Writer instance.
- `write(out)`: Writes the tiled PNG data to the specified output.
- `export(TiledPNGWriter)`: Exports the TiledPNGWriter class.

## File: src\js\subtitles.js
**Description:** This file contains functions related to handling subtitles, likely for video playback or other media within the application.

### Functions/Methods:
- `getSubtitle(id)`: Retrieves subtitle data based on a given ID.
- `export(getSubtitle)`: Exports the function to retrieve subtitle data.

## File: src\js\png-writer.js
**Description:** This file implements a writer for generating PNG images, providing functionality to convert raw image data into the PNG format.

### Functions/Methods:
- `PNGWriter(PNGWriter)`: Constructor for a PNG Writer instance.
- `write(data)`: Writes the PNG image data to the specified output.
- `export(PNGWriter)`: Exports the PNGWriter class.

## File: src\js\mpq\pkware.js
**Description:** This file contains functions related to PKWARE data compression and encryption algorithms, which are often used in MPQ archives.

### Functions/Methods:
- `encryptBlock(block, key)`: Encrypts a block of data using a given key.
- `decryptBlock(block, key)`: Decrypts a block of data using a given key.
- `hashString(str, hashType)`: Generates a hash for a string using a specified hash type.
- `export(encryptBlock, decryptBlock, hashString)`: Exports functions for PKWARE encryption, decryption, and string hashing.

## File: src\js\mpq\mpq.js
**Description:** This file provides core functionality for interacting with MPQ (Mo'PaQ) archives, which are used to store game data for Blizzard games.

### Functions/Methods:
- `MPQ(MPQ)`: Constructor for an MPQ archive handler.
- `open(file, region)`: Opens an MPQ archive file for reading, optionally specifying a region.
- `close()`: Closes the currently open MPQ archive.
- `getFile(filename)`: Retrieves a specific file from the MPQ archive by its filename.
- `export(MPQ)`: Exports the MPQ class for archive interaction.

## File: src\js\mpq\mpq-install.js
**Description:** This file handles the parsing and retrieval of data from MPQ install files, which specify how game data should be installed.

### Functions/Methods:
- `readInstallFile(installFile)`: Reads and processes an MPQ install file.
- `getInstallFile(installFile)`: Retrieves the contents of an MPQ install file.
- `export(readInstallFile, getInstallFile)`: Exports functions for reading and getting MPQ install files.

## File: src\js\mpq\huffman.js
**Description:** This file implements Huffman coding, a variable-length encoding scheme used for lossless data compression, likely within MPQ archives.

### Functions/Methods:
- `Huffman(Huffman)`: Constructor for a Huffman decoder/encoder.
- `decompress(data)`: Decompresses data using Huffman coding.
- `export(Huffman)`: Exports the Huffman class for data compression.

## File: src\js\mpq\bzip2.js
**Description:** This file implements the BZip2 compression algorithm, a high-quality block-sorting file compressor used for lossless data compression, often found in MPQ archives.

### Functions/Methods:
- `decompress(data)`: Decompresses data using the BZip2 algorithm.
- `export(decompress)`: Exports the BZip2 decompression function.

## File: src\js\mpq\build-version.js
**Description:** This file provides functionality for determining the build version of game data, often by parsing configuration files from CASC or MPQ sources.

### Functions/Methods:
- `getBuildVersion(cdnConfig, buildConfig)`: Retrieves the build version based on CDN and build configuration data.
- `export(getBuildVersion)`: Exports the function to get the build version.

## File: src\js\mpq\bitstream.js
**Description:** This file implements a BitStream reader, allowing for reading data at bit-level granularity from a buffer, essential for parsing compressed or packed data formats.

### Functions/Methods:
- `BitStream(BitStream)`: Constructor for a BitStream reader.
- `offset(offset)`: Sets the current bit offset within the stream.
- `readBits(count)`: Reads a specified number of bits from the stream.
- `readByte()`: Reads a single byte from the stream.
- `readBytes(count)`: Reads a specified number of bytes from the stream.
- `seek(offset)`: Sets the read position within the bitstream to a new offset.
- `tell()`: Returns the current bit offset within the stream.
- `size()`: Returns the total size of the underlying buffer in bits.
- `export(BitStream)`: Exports the BitStream class.

## File: src\js\modules\tab_zones.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages zone-related information within the application.

### Functions/Methods:
- `init()`: Initializes the zones tab UI and its components.
- `loadZones()`: Loads and displays zone data in the tab.

## File: src\js\modules\tab_videos.js
**Description:** This file likely defines the functionality for a UI tab dedicated to displaying and managing video content within the application.

### Functions/Methods:
- `init()`: Initializes the video tab UI and its components.
- `loadVideos()`: Loads and displays video data in the tab.

## File: src\js\modules\tab_textures.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages texture assets within the application.

### Functions/Methods:
- `init()`: Initializes the textures tab UI and its components.
- `loadTextures()`: Loads and displays texture data in the tab.

## File: src\js\modules\tab_text.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages text-based content or localized strings within the application.

### Functions/Methods:
- `init()`: Initializes the text tab UI and its components.
- `loadText()`: Loads and displays text data in the tab.

## File: src\js\modules\tab_raw.js
**Description:** This file likely defines the functionality for a UI tab that allows viewing and managing raw data or files directly.

### Functions/Methods:
- `init()`: Initializes the raw data tab UI and its components.
- `loadRaw()`: Loads and displays raw file data in the tab.

## File: src\js\modules\tab_models_legacy.js
**Description:** This file likely defines the functionality for a UI tab that handles legacy 3D model assets within the application.

### Functions/Methods:
- `init()`: Initializes the legacy models tab UI and its components.
- `loadModels()`: Loads and displays legacy 3D model data in the tab.

## File: src\js\modules\tab_models.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages 3D model assets within the application.

### Functions/Methods:
- `init()`: Initializes the models tab UI and its components.
- `loadModels()`: Loads and displays 3D model data in the tab.

## File: src\js\modules\tab_maps.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages map-related data and assets within the application.

### Functions/Methods:
- `init()`: Initializes the maps tab UI and its components.
- `loadMaps()`: Loads and displays map data in the tab.

## File: src\js\modules\tab_items.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages item-related data and assets within the application.

### Functions/Methods:
- `init()`: Initializes the items tab UI and its components.
- `loadItems()`: Loads and displays item data in the tab.

## File: src\js\modules\tab_item_sets.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages item set-related data within the application.

### Functions/Methods:
- `init()`: Initializes the item sets tab UI and its components.
- `loadItemSets()`: Loads and displays item set data in the tab.

## File: src\js\modules\tab_install.js
**Description:** This file likely defines the functionality for a UI tab that displays information related to the application's installation or game data installation.

### Functions/Methods:
- `init()`: Initializes the installation tab UI and its components.
- `loadInstall()`: Loads and displays installation-related data in the tab.

## File: src\js\modules\tab_home.js
**Description:** This file likely defines the functionality for the main home screen or dashboard UI tab of the application.

### Functions/Methods:
- `init()`: Initializes the home tab UI and its components.

## File: src\js\modules\tab_help.js
**Description:** This file likely defines the functionality for a UI tab that provides help documentation, FAQs, or support information to the user.

### Functions/Methods:
- `init()`: Initializes the help tab UI and its components.

## File: src\js\modules\tab_fonts.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages font assets within the application.

### Functions/Methods:
- `init()`: Initializes the fonts tab UI and its components.
- `loadFonts()`: Loads and displays font data in the tab.

## File: src\js\modules\tab_decor.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages decorative assets or environmental elements within the application.

### Functions/Methods:
- `init()`: Initializes the decor tab UI and its components.
- `loadDecor()`: Loads and displays decorative asset data in the tab.

## File: src\js\modules\tab_data.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages generic data structures or raw data views within the application.

### Functions/Methods:
- `init()`: Initializes the data tab UI and its components.
- `loadData()`: Loads and displays generic data structures in the tab.

## File: src\js\modules\tab_characters.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages character-related models, textures, or customization options within the application.

### Functions/Methods:
- `init()`: Initializes the characters tab UI and its components.
- `loadCharacters()`: Loads and displays character data in the tab.

## File: src\js\modules\tab_changelog.js
**Description:** This file likely defines the functionality for a UI tab that displays the application's changelog or version history.

### Functions/Methods:
- `init()`: Initializes the changelog tab UI and its components.

## File: src\js\modules\tab_blender.js
**Description:** This file likely defines the functionality for a UI tab that provides tools or information related to Blender integration within the application.

### Functions/Methods:
- `init()`: Initializes the Blender tab UI and its components.
- `openBlenderAddon()`: Opens the Blender addon directory or installation guide.

## File: src\js\modules\tab_audio.js
**Description:** This file likely defines the functionality for a UI tab that displays and manages audio assets within the application.

### Functions/Methods:
- `init()`: Initializes the audio tab UI and its components.
- `loadAudio()`: Loads and displays audio data in the tab.

## File: src\js\modules\screen_source_select.js
**Description:** This file defines the functionality for a screen or module that allows users to select data sources for the application.

### Functions/Methods:
- `init()`: Initializes the source selection screen UI and logic.
- `refreshSources()`: Refreshes the list of available data sources.

## File: src\js\modules\screen_settings.js
**Description:** This file defines the functionality for a screen or module that allows users to configure application settings and preferences.

### Functions/Methods:
- `init()`: Initializes the settings screen UI and logic.
- `setRenderer(renderer)`: Sets the application's rendering engine or mode.
- `resetConfig()`: Resets application configuration to default values.

## File: src\js\modules\module_test_b.js
**Description:** This file appears to be a test module for part B of a modular system, likely containing placeholder or demonstration functionality.

### Functions/Methods:
- `init()`: Initializes the test module B.

## File: src\js\modules\module_test_a.js
**Description:** This file appears to be a test module for part A of a modular system, likely containing placeholder or demonstration functionality.

### Functions/Methods:
- `init()`: Initializes the test module A.

## File: src\js\modules\legacy_tab_textures.js
**Description:** This file likely defines functionality for a legacy UI tab that handles texture assets within the application, possibly for older data formats.

### Functions/Methods:
- `init()`: Initializes the legacy textures tab UI and its components.
- `loadTextures()`: Loads and displays legacy texture data in the tab.

## File: src\js\modules\legacy_tab_home.js
**Description:** This file likely defines functionality for a legacy home screen or dashboard UI tab of the application.

### Functions/Methods:
- `init()`: Initializes the legacy home tab UI and its components.

## File: src\js\modules\legacy_tab_fonts.js
**Description:** This file likely defines functionality for a legacy UI tab that handles font assets within the application, possibly for older font formats.

### Functions/Methods:
- `init()`: Initializes the legacy fonts tab UI and its components.
- `loadFonts()`: Loads and displays legacy font data in the tab.

## File: src\js\modules\legacy_tab_files.js
**Description:** This file likely defines functionality for a legacy UI tab that allows viewing and managing generic files, possibly from older game data structures.

### Functions/Methods:
- `init()`: Initializes the legacy files tab UI and its components.
- `loadFiles()`: Loads and displays legacy file data in the tab.

## File: src\js\modules\legacy_tab_data.js
**Description:** This file likely defines functionality for a legacy UI tab that handles generic data structures or raw data views, possibly for older data formats.

### Functions/Methods:
- `init()`: Initializes the legacy data tab UI and its components.
- `loadData()`: Loads and displays legacy data structures in the tab.

## File: src\js\modules\legacy_tab_audio.js
**Description:** This file likely defines functionality for a legacy UI tab that handles audio assets within the application, possibly for older audio formats.

### Functions/Methods:
- `init()`: Initializes the legacy audio tab UI and its components.
- `loadAudio()`: Loads and displays legacy audio data in the tab.

## File: src\js\modules\font_helpers.js
**Description:** This file provides helper functions specifically for managing and registering fonts used within the application.

### Functions/Methods:
- `registerFonts(fonts)`: Registers a collection of font assets for use in the application.
- `export(registerFonts)`: Exports the function for registering fonts.

## File: src\js\modules.js
**Description:** This file likely acts as a central module loader or manager for other modules within the application, providing a way to retrieve them dynamically.

### Functions/Methods:
- `getModule(path)`: Retrieves a specific module by its path.
- `export(getModule)`: Exports the function to get modules.

## File: src\js\mmap.js
**Description:** This file appears to be a wrapper or interface for memory-mapped file operations, likely bridging to a native `mmap` module for performance.

### Functions/Methods:
- `mmap(mmap)`: Represents the memory-mapped file object or constructor.
- `export(mmap)`: Exports the `mmap` functionality.

## File: src\js\log.js
**Description:** This file provides logging utilities for the application, allowing messages to be written to a log file, viewed, or cleared.

### Functions/Methods:
- `write(content)`: Writes content to the application's log.
- `view()`: Opens the log file for viewing.
- `open()`: Opens the log file in a default external viewer.
- `clear()`: Clears the contents of the log file.
- `export(write, view, open, clear)`: Exports logging utility functions.

## File: src\js\install-type.js
**Description:** This file defines types of installations and provides utilities to determine the specific installation type of the application or game data.

### Functions/Methods:
- `INSTALL_TYPE_ENUM(INSTALL_TYPE_ENUM)`: An enumeration defining different installation types.
- `getInstallType(path)`: Retrieves the installation type based on a given path.
- `export(INSTALL_TYPE_ENUM, getInstallType)`: Exports the installation type enumeration and a function to get installation types.

## File: src\js\icon-render.js
**Description:** This file provides functionality for rendering application icons or in-game icons, possibly handling different sizes and formats.

### Functions/Methods:
- `renderIcon(iconID, width, height)`: Renders an icon based on its ID, specifying width and height.
- `export(renderIcon)`: Exports the function for rendering icons.

## File: src\js\hashing\xxhash64.js
**Description:** This file implements the XXHash64 hashing algorithm, a fast non-cryptographic hash function, likely used for data integrity checks or unique identification.

### Functions/Methods:
- `hash(buf, seed)`: Computes the XXHash64 hash for a buffer with an optional seed.
- `export(hash)`: Exports the XXHash64 hashing function.

## File: src\js\gpu-info.js
**Description:** This file retrieves and provides information about the system's Graphics Processing Unit (GPU), which can be useful for debugging or optimizing rendering.

### Functions/Methods:
- `getGPUInfo()`: Retrieves detailed information about the system's GPU.
- `export(getGPUInfo)`: Exports the function to get GPU information.

## File: src\js\generics.js
**Description:** This file contains a collection of generic utility functions that are broadly applicable across different parts of the application, such as data manipulation, URL handling, and timing.

### Functions/Methods:
- `get(key, defaultValue)`: Retrieves a configuration value by key, providing a default if not found.
- `set(key, value)`: Sets a configuration value for a given key.
- `openURL(url)`: Opens a specified URL in the system's default web browser.
- `clone(obj)`: Creates a deep clone of a given JavaScript object.
- `toHEX(buffer)`: Converts a buffer of data into its hexadecimal string representation.
- `byteToHex(byte)`: Converts a single byte value into its two-character hexadecimal string representation.
- `sleep(ms)`: Pauses execution for a specified number of milliseconds.
- `downloadFile(url, fileName)`: Downloads a file from a URL and saves it with a specified filename.
- `export(get, set, openURL, clone, toHEX, byteToHex, sleep, downloadFile)`: Exports various generic utility functions.

## File: src\js\file-writer.js
**Description:** This file implements a file writing utility, providing methods to write content to a file, close it, and retrieve its path.

### Functions/Methods:
- `FileWriter(FileWriter)`: Constructor for a file writer object.
- `write(content)`: Writes content to the file.
- `close()`: Closes the file writer, ensuring all buffered data is written.
- `getPath()`: Retrieves the path of the file being written to.
- `export(FileWriter)`: Exports the FileWriter class.

## File: src\js\external-links.js
**Description:** This file manages external links, providing functionality to safely open URLs in the system's default browser or handle them appropriately.

### Functions/Methods:
- `openExternalLink(url)`: Opens an external URL in the default web browser.
- `export(openExternalLink)`: Exports the function for opening external links.

## File: src\js\db\caches\DBTextureFileData.js
**Description:** This file provides caching mechanisms for texture file data from the application's database, optimizing retrieval of frequently accessed texture information.

### Functions/Methods:
- `getTextureFileData(id)`: Retrieves texture file data based on its unique identifier (ID) from the cache or database.
- `export(getTextureFileData)`: Exports the function to get texture file data.

## File: src\js\db\caches\DBModelFileData.js
**Description:** This file provides caching mechanisms for 3D model file data from the application's database, optimizing retrieval of frequently accessed model information.

### Functions/Methods:
- `getModelFileData(id)`: Retrieves 3D model file data based on its unique identifier (ID) from the cache or database.
- `export(getModelFileData)`: Exports the function to get model file data.

## File: src\js\db\caches\DBItems.js
**Description:** This file provides caching mechanisms for item data from the application's database, optimizing retrieval of frequently accessed item information.

### Functions/Methods:
- `getItems(id)`: Retrieves item data based on its unique identifier (ID) from the cache or database.
- `export(getItems)`: Exports the function to get item data.

## File: src\js\db\caches\DBItemModels.js
**Description:** This file provides caching mechanisms for item model data from the application's database, optimizing retrieval of frequently accessed item model information.

### Functions/Methods:
- `getItemModel(id)`: Retrieves item model data based on its unique identifier (ID) from the cache or database.
- `export(getItemModel)`: Exports the function to get item model data.

## File: src\js\db\caches\DBItemGeosets.js
**Description:** This file provides caching mechanisms for item geoset data from the application's database, optimizing retrieval of frequently accessed item geoset information.

### Functions/Methods:
- `getItemGeosets(id)`: Retrieves item geoset data based on its unique identifier (ID) from the cache or database.
- `export(getItemGeosets)`: Exports the function to get item geoset data.

## File: src\js\db\caches\DBItemDisplays.js
**Description:** This file provides caching mechanisms for item display data from the application's database, optimizing retrieval of frequently accessed item display information.

### Functions/Methods:
- `getItemDisplay(id)`: Retrieves item display data based on its unique identifier (ID) from the cache or database.
- `export(getItemDisplay)`: Exports the function to get item display data.

## File: src\js\db\caches\DBItemCharTextures.js
**Description:** This file provides caching mechanisms for item character texture data from the application's database, optimizing retrieval of frequently accessed character texture information.

### Functions/Methods:
- `getItemCharTexture(id)`: Retrieves item character texture data based on its unique identifier (ID) from the cache or database.
- `export(getItemCharTexture)`: Exports the function to get item character texture data.

## File: src\js\db\caches\DBGuildTabard.js
**Description:** This file provides caching mechanisms for guild tabard data from the application's database, optimizing retrieval of frequently accessed tabard information.

### Functions/Methods:
- `getGuildTabard(id)`: Retrieves guild tabard data based on its unique identifier (ID) from the cache or database.
- `export(getGuildTabard)`: Exports the function to get guild tabard data.

## File: src\js\db\caches\DBDecorCategories.js
**Description:** This file provides caching mechanisms for decor category data from the application's database, optimizing retrieval of frequently accessed category information.

### Functions/Methods:
- `getDecorCategory(id)`: Retrieves decor category data based on its unique identifier (ID) from the cache or database.
- `export(getDecorCategory)`: Exports the function to get decor category data.

## File: src\js\db\caches\DBDecor.js
**Description:** This file provides caching mechanisms for decorative object data from the application's database, optimizing retrieval of frequently accessed decor information.

### Functions/Methods:
- `getDecor(id)`: Retrieves decorative object data based on its unique identifier (ID) from the cache or database.
- `export(getDecor)`: Exports the function to get decorative object data.

## File: src\js\db\caches\DBCreaturesLegacy.js
**Description:** This file provides caching mechanisms for legacy creature data from the application's database, optimizing retrieval of frequently accessed creature information for older game versions.

### Functions/Methods:
- `getCreatureLegacy(id)`: Retrieves legacy creature data based on its unique identifier (ID) from the cache or database.
- `export(getCreatureLegacy)`: Exports the function to get legacy creature data.

## File: src\js\db\caches\DBCreatures.js
**Description:** This file provides caching mechanisms for creature data from the application's database, optimizing retrieval of frequently accessed creature information.

### Functions/Methods:
- `getCreature(id)`: Retrieves creature data based on its unique identifier (ID) from the cache or database.
- `export(getCreature)`: Exports the function to get creature data.

## File: src\js\db\caches\DBComponentModelFileData.js
**Description:** This file provides caching mechanisms for component model file data from the application's database, optimizing retrieval of frequently accessed component model information.

### Functions/Methods:
- `getComponentModelFileData(id)`: Retrieves component model file data based on its unique identifier (ID) from the cache or database.
- `export(getComponentModelFileData)`: Exports the function to get component model file data.

## File: src\js\db\WDCReader.js
**Description:** This file implements a reader for WDC (World Data Content) database files, which are used to store various game data tables.

### Functions/Methods:
- `WDCReader(WDCReader)`: Constructor for a WDC database reader.
- `parse()`: Parses the loaded WDC file content.
- `getRow(id)`: Retrieves a specific row from the WDC database by its ID.
- `export(WDCReader)`: Exports the WDCReader class.

## File: src\js\db\FieldType.js
**Description:** This file defines enumeration and utility functions for various field types encountered in database files, facilitating proper interpretation of data.

### Functions/Methods:
- `FIELD_TYPE_ENUM(FIELD_TYPE_ENUM)`: An enumeration defining various database field types.
- `getFieldType(type)`: Retrieves the field type based on a given type identifier.
- `export(FIELD_TYPE_ENUM, getFieldType)`: Exports the field type enumeration and a function to get field types.

## File: src\js\db\DBDParser.js
**Description:** This file implements a parser for DBD (Database Definition) files, which define the structure and schema of database tables.

### Functions/Methods:
- `DBDParser(DBDParser)`: Constructor for a DBD file parser.
- `parse()`: Parses the loaded DBD file content to extract schema information.
- `export(DBDParser)`: Exports the DBDParser class.

## File: src\js\db\DBCReader.js
**Description:** This file implements a reader for DBC (Database Client) files, which are used to store various game data tables.

### Functions/Methods:
- `DBCReader(DBCReader)`: Constructor for a DBC database reader.
- `parse()`: Parses the loaded DBC file content.
- `getRow(id)`: Retrieves a specific row from the DBC database by its ID.
- `export(DBCReader)`: Exports the DBCReader class.

## File: src\js\db\CompressionType.js
**Description:** This file defines enumeration and utility functions for various compression types used in data files, facilitating proper handling of compressed data.

### Functions/Methods:
- `COMPRESSION_TYPE_ENUM(COMPRESSION_TYPE_ENUM)`: An enumeration defining various data compression types.
- `getCompressionType(type)`: Retrieves the compression type based on a given type identifier.
- `export(COMPRESSION_TYPE_ENUM, getCompressionType)`: Exports the compression type enumeration and a function to get compression types.

## File: src\js\crc32.js
**Description:** This file provides a utility function for calculating the CRC32 (Cyclic Redundancy Check) checksum, commonly used for data integrity verification.

### Functions/Methods:
- `crc32(buffer)`: Calculates the CRC32 checksum for a given data buffer.
- `export(crc32)`: Exports the CRC32 calculation function.

## File: src\js\core.js
**Description:** This file likely contains core initialization logic and foundational setup for the entire application.

### Functions/Methods:
- `init()`: Initializes the core components and settings of the application.
- `export(init)`: Exports the core initialization function.

## File: src\js\constants.js
**Description:** This file defines various constant values used throughout the application, providing a centralized location for configuration and magic numbers.

### Functions/Methods:
- No user-defined functions found in this script.

## File: src\js\config.js
**Description:** This file provides functionality for managing application configuration, including getting, setting, and saving configuration values.

### Functions/Methods:
- `get(key, defaultValue)`: Retrieves a configuration value by its key, returning a default value if not found.
- `set(key, value)`: Sets a configuration value for a given key.
- `save()`: Saves the current application configuration to persistent storage.
- `export(get, set, save)`: Exports functions for configuration management.

## File: src\js\components\slider.js
**Description:** This file likely defines and registers a custom UI slider component for the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the slider component with the application's UI framework.

## File: src\js\components\resize-layer.js
**Description:** This file likely defines and registers a custom UI resize layer component, allowing parts of the UI to be dynamically resized.

### Functions/Methods:
- `registerComponent(name)`: Registers the resize layer component with the application's UI framework.

## File: src\js\components\model-viewer-gl.js
**Description:** This file likely defines and registers a custom UI component for displaying 3D models using WebGL.

### Functions/Methods:
- `registerComponent(name)`: Registers the 3D model viewer (WebGL) component with the application's UI framework.

## File: src\js\components\menu-button.js
**Description:** This file likely defines and registers a custom UI menu button component for the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the menu button component with the application's UI framework.

## File: src\js\components\markdown-content.js
**Description:** This file likely defines and registers a custom UI component for rendering Markdown formatted content within the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the Markdown content rendering component with the application's UI framework.

## File: src\js\components\map-viewer.js
**Description:** This file likely defines and registers a custom UI component for displaying interactive maps within the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the map viewer component with the application's UI framework.

## File: src\js\components\listboxb.js
**Description:** This file likely defines and registers a custom UI listbox component (version 'b' or a variation) for the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the listbox (version B) component with the application's UI framework.

## File: src\js\components\listbox.js
**Description:** This file likely defines and registers a custom UI listbox component for the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the listbox component with the application's UI framework.

## File: src\js\components\listbox-zones.js
**Description:** This file likely defines and registers a custom UI listbox component specifically for displaying and interacting with zone data.

### Functions/Methods:
- `registerComponent(name)`: Registers the zones listbox component with the application's UI framework.

## File: src\js\components\listbox-maps.js
**Description:** This file likely defines and registers a custom UI listbox component specifically for displaying and interacting with map data.

### Functions/Methods:
- `registerComponent(name)`: Registers the maps listbox component with the application's UI framework.

## File: src\js\components\itemlistbox.js
**Description:** This file likely defines and registers a custom UI listbox component specifically for displaying and interacting with item data.

### Functions/Methods:
- `registerComponent(name)`: Registers the item listbox component with the application's UI framework.

## File: src\js\components\home-showcase.js
**Description:** This file likely defines and registers a custom UI component for displaying a showcase or featured content on the application's home screen.

### Functions/Methods:
- `registerComponent(name)`: Registers the home showcase component with the application's UI framework.

## File: src\js\components\file-field.js
**Description:** This file likely defines and registers a custom UI file input field component for the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the file field component with the application's UI framework.

## File: src\js\components\data-table.js
**Description:** This file likely defines and registers a custom UI data table component for displaying tabular data within the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the data table component with the application's UI framework.

## File: src\js\components\context-menu.js
**Description:** This file likely defines and registers a custom UI context menu component, often triggered by a right-click, for the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the context menu component with the application's UI framework.

## File: src\js\components\combobox.js
**Description:** This file likely defines and registers a custom UI combobox (dropdown with text input) component for the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the combobox component with the application's UI framework.

## File: src\js\components\checkboxlist.js
**Description:** This file likely defines and registers a custom UI checkbox list component for the application.

### Functions/Methods:
- `registerComponent(name)`: Registers the checkbox list component with the application's UI framework.

## File: src\js\casc\vp9-avi-demuxer.js
**Description:** This file implements a demuxer for VP9 encoded video within AVI containers, used for parsing and extracting video and audio streams.

### Functions/Methods:
- `VP9AVIBuffer(VP9AVIBuffer)`: Constructor for a VP9 AVI buffer handler.
- `getVideoTrack()`: Retrieves the video track information from the AVI container.
- `getAudioTrack()`: Retrieves the audio track information from the AVI container.
- `getChunk(index)`: Retrieves a specific data chunk from the AVI container by its index.
- `export(VP9AVIBuffer)`: Exports the VP9AVIBuffer class.

## File: src\js\casc\version-config.js
**Description:** This file provides functionality for managing version configurations within CASC game data, helping to identify and select correct game versions.

### Functions/Methods:
- `getVersionConfig(build, tact)`: Retrieves the version configuration based on build and TACT (Threat Assessment & Containment Team) identifiers.
- `export(getVersionConfig)`: Exports the function to get version configurations.

## File: src\js\casc\tact-keys.js
**Description:** This file manages TACT (Threat Assessment & Containment Team) keys, which are cryptographic keys used to decrypt and access content within CASC archives.

### Functions/Methods:
- `getTactKey(keyName)`: Retrieves a specific TACT key by its name.
- `export(getTactKey)`: Exports the function to get TACT keys.

## File: src\js\casc\salsa20.js
**Description:** This file implements the Salsa20 stream cipher, a cryptographic algorithm used for encryption and decryption of data streams, possibly within CASC archives.

### Functions/Methods:
- `Salsa20(Salsa20)`: Constructor for a Salsa20 cipher instance.
- `setKey(key)`: Sets the cryptographic key for the Salsa20 cipher.
- `setNonce(nonce)`: Sets the nonce (number used once) for the Salsa20 cipher.
- `setCounter(counter)`: Sets the counter value for the Salsa20 cipher.
- `encrypt(data)`: Encrypts a block of data using the Salsa20 cipher.
- `decrypt(data)`: Decrypts a block of data using the Salsa20 cipher.
- `export(Salsa20)`: Exports the Salsa20 cipher class.

## File: src\js\casc\realmlist.js
**Description:** This file handles information related to game realms, likely providing utilities to resolve regions or connect to specific game servers.

### Functions/Methods:
- `getRegion(realm)`: Retrieves the geographic region associated with a given game realm.
- `export(getRegion)`: Exports the function to get realm region information.

## File: src\js\casc\locale-flags.js
**Description:** This file defines and manages locale flags, which indicate supported languages or regions for game content within CASC archives.

### Functions/Methods:
- `getLocaleFlags(region)`: Retrieves the locale flags applicable to a specified region.
- `export(getLocaleFlags)`: Exports the function to get locale flags.

## File: src\js\casc\listfile.js
**Description:** This file manages the "listfile" for CASC archives, which maps file content hashes to human-readable filenames.

### Functions/Methods:
- `getListfile()`: Retrieves the CASC listfile, containing mappings of file hashes to names.
- `export(getListfile)`: Exports the function to get the CASC listfile.

## File: src\js\casc\jenkins96.js
**Description:** This file implements the Jenkins hash function (specifically a 96-bit version), often used for fast, non-cryptographic hashing of data within game archives.

### Functions/Methods:
- `hash(buffer)`: Computes the Jenkins96 hash for a given data buffer.
- `export(hash)`: Exports the Jenkins96 hashing function.

## File: src\js\casc\install-manifest.js
**Description:** This file handles the parsing and retrieval of data from CASC install manifests, which specify how game data should be installed.

### Functions/Methods:
- `getInstallManifest(cdnConfig, buildConfig)`: Retrieves the install manifest based on CDN and build configuration data.
- `export(getInstallManifest)`: Exports the function to get the install manifest.

## File: src\js\casc\export-helper.js
**Description:** This file provides a suite of helper functions for exporting various types of data (files, images, JSON, CSV, etc.) from the application, including directory creation and path management.

### Functions/Methods:
- `createDirectory(dir)`: Creates a directory if it does not already exist.
- `getExportPath(file)`: Generates a full export path for a given file.
- `getExportDir()`: Retrieves the base directory configured for exports.
- `exportFile(file, content)`: Exports generic file content to a specified file.
- `exportCanvas(canvas, file)`: Exports the content of an HTML canvas element to an image file.
- `exportImage(image, file)`: Exports an image object to a specified file.
- `exportBuffer(buffer, file)`: Exports a data buffer to a specified file.
- `exportPNG(canvas, file)`: Exports the content of an HTML canvas element as a PNG image.
- `exportJSON(data, file)`: Exports JavaScript data as a JSON file.
- `exportCSV(data, file)`: Exports tabular data as a CSV file.
- `exportTXT(data, file)`: Exports text data as a plain text file.
- `export(createDirectory, getExportPath, getExportDir, exportFile, exportCanvas, exportImage, exportBuffer, exportPNG, exportJSON, exportCSV, exportTXT)`: Exports various helper functions for data exporting.

## File: src\js\casc\dbd-manifest.js
**Description:** This file handles the parsing and retrieval of data from CASC DBD (Database Definition) manifests, which describe database table structures.

### Functions/Methods:
- `getDBDManifest(buildConfig)`: Retrieves the DBD manifest based on build configuration data.
- `export(getDBDManifest)`: Exports the function to get the DBD manifest.

## File: src\js\casc\db2.js
**Description:** This file provides functionality for interacting with DB2 database files within CASC archives, allowing retrieval of game data.

### Functions/Methods:
- `getDB2File(filename)`: Retrieves a specific DB2 file from the CASC archive.
- `export(getDB2File)`: Exports the function to get DB2 files.

## File: src\js\casc\content-flags.js
**Description:** This file defines and manages content flags, which indicate the presence or availability of certain types of content within CASC archives.

### Functions/Methods:
- `hasContentFlag(flag)`: Checks if a specific content flag is set.
- `export(hasContentFlag)`: Exports the function to check content flags.

## File: src\js\casc\cdn-resolver.js
**Description:** This file provides functionality for resolving CDN (Content Delivery Network) hostnames to appropriate URLs for CASC data access.

### Functions/Methods:
- `resolveCDN(host)`: Resolves a CDN hostname to a full URL for CASC data.
- `export(resolveCDN)`: Exports the function to resolve CDN hostnames.

## File: src\js\casc\cdn-config.js
**Description:** This file handles the parsing and retrieval of data from CASC CDN (Content Delivery Network) configuration files, used for locating game data.

### Functions/Methods:
- `getCDNConfig(host)`: Retrieves the CDN configuration for a given host.
- `export(getCDNConfig)`: Exports the function to get CDN configurations.

## File: src\js\casc\casc-source.js
**Description:** This file serves as a base or abstract class for CASC (Content Addressable Storage Container) data sources, defining common interfaces for accessing game data.

### Functions/Methods:
- `CASCSource(CASCSource)`: Constructor for a CASC data source.
- `load()`: Loads the CASC data source.
- `getFile(filename)`: Retrieves a specific file from the CASC source.
- `export(CASCSource)`: Exports the CASCSource class.

## File: src\js\casc\casc-source-remote.js
**Description:** This file implements a remote CASC (Content Addressable Storage Container) data source, allowing the application to access game data over a network.

### Functions/Methods:
- `CASCSourceRemote(CASCSourceRemote)`: Constructor for a remote CASC data source.
- `load()`: Loads the remote CASC data source.
- `getFile(filename)`: Retrieves a specific file from the remote CASC source.
- `export(CASCSourceRemote)`: Exports the CASCSourceRemote class.

## File: src\js\casc\casc-source-local.js
**Description:** This file implements a local CASC (Content Addressable Storage Container) data source, allowing the application to access game data from the local filesystem.

### Functions/Methods:
- `CASCSourceLocal(CASCSourceLocal)`: Constructor for a local CASC data source.
- `load()`: Loads the local CASC data source.
- `getFile(filename)`: Retrieves a specific file from the local CASC source.
- `export(CASCSourceLocal)`: Exports the CASCSourceLocal class.

## File: src\js\casc\build-cache.js
**Description:** This file manages a cache for CASC build data, optimizing the retrieval of frequently accessed build-specific information.

### Functions/Methods:
- `getBuildCache(cdnConfig, buildConfig)`: Retrieves build cache data based on CDN and build configuration.
- `export(getBuildCache)`: Exports the function to get build cache data.

## File: src\js\casc\blte-stream-reader.js
**Description:** This file implements a stream reader for BLTE (Blizzard Texture and Layout Encoded) compressed data, allowing for efficient reading of CASC content.

### Functions/Methods:
- `BLTEStreamReader(BLTEStreamReader)`: Constructor for a BLTE stream reader.
- `read(offset, length)`: Reads a specified amount of data from the BLTE stream at a given offset.
- `export(BLTEStreamReader)`: Exports the BLTEStreamReader class.

## File: src\js\casc\blte-reader.js
**Description:** This file implements a reader for BLTE (Blizzard Texture and Layout Encoded) compressed data, used for decompressing and processing CASC content blocks.

### Functions/Methods:
- `BLTEReader(BLTEReader)`: Constructor for a BLTE data reader.
- `parse()`: Parses the BLTE compressed data.
- `export(BLTEReader)`: Exports the BLTEReader class.

## File: src\js\casc\blp.js
**Description:** This file provides functionality for parsing and handling BLP (Blizzard Picture) image files, commonly used in Blizzard games for textures.

### Functions/Methods:
- `BLPFile(BLPFile)`: Constructor for a BLP image file handler.
- `parse()`: Parses the BLP image file content.
- `getImage(mipmap)`: Retrieves an image representation from a specific mipmap level of the BLP file.
- `export(BLPFile)`: Exports the BLPFile class.

## File: src\js\buffer.js
**Description:** This file provides a utility class for wrapping and manipulating binary data buffers, offering various methods for reading different data types at specific offsets.

### Functions/Methods:
- `BufferWrapper(BufferWrapper)`: Constructor for a buffer wrapper object.
- `getUint8(offset)`: Retrieves an 8-bit unsigned integer from the buffer at the specified offset.
- `getUint16(offset)`: Retrieves a 16-bit unsigned integer from the buffer at the specified offset.
- `getUint32(offset)`: Retrieves a 32-bit unsigned integer from the buffer at the specified offset.
- `getInt8(offset)`: Retrieves an 8-bit signed integer from the buffer at the specified offset.
- `getInt16(offset)`: Retrieves a 16-bit signed integer from the buffer at the specified offset.
- `getInt32(offset)`: Retrieves a 32-bit signed integer from the buffer at the specified offset.
- `getFloat32(offset)`: Retrieves a 32-bit floating-point number from the buffer at the specified offset.
- `getFloat64(offset)`: Retrieves a 64-bit floating-point number from the buffer at the specified offset.
- `getString(offset, length)`: Retrieves a string from the buffer at the specified offset with a given length.
- `getBuffer(offset, length)`: Retrieves a sub-buffer from the buffer at the specified offset with a given length.
- `slice(offset, length)`: Creates a new BufferWrapper instance representing a slice of the original buffer.
- `readBytes(length)`: Reads a specified number of bytes from the current position in the buffer.
- `seek(offset)`: Sets the current read position within the buffer to a new offset.
- `tell()`: Returns the current read position within the buffer.
- `size()`: Returns the total size of the underlying buffer in bytes.
- `export(BufferWrapper)`: Exports the BufferWrapper class.

## File: src\js\MultiMap.js
**Description:** This file implements a MultiMap data structure, which allows multiple values to be associated with a single key.

### Functions/Methods:
- `MultiMap(MultiMap)`: Constructor for a MultiMap instance.
- `set(key, value)`: Adds a value to the list associated with the specified key.
- `get(key)`: Retrieves all values associated with the specified key as an array.
- `has(key)`: Checks if the MultiMap contains the specified key.
- `delete(key, value)`: Removes a specific value associated with a key, or the entire key if no value is specified.
- `clear()`: Clears all key-value pairs from the MultiMap.
- `size()`: Returns the total number of unique keys in the MultiMap.
- `export(MultiMap)`: Exports the MultiMap class.

## File: src\js\blob.js
**Description:** This file provides utility functions for creating Blob (Binary Large Object) instances, typically used for handling binary data in web contexts.

### Functions/Methods:
- `createBlob(buffer, mime)`: Creates a Blob object from a given data buffer and MIME type.
- `export(createBlob)`: Exports the function to create Blob objects.

## File: src\js\3D\writers\STLWriter.js
**Description:** This file implements a writer for STL (STereoLithography) files, a common format for 3D models used in CAD software and 3D printing.

### Functions/Methods:
- `STLWriter(STLWriter)`: Constructor for an STL file writer.
- `write(out)`: Writes the 3D model data to an STL file format.
- `export(STLWriter)`: Exports the STLWriter class.

## File: src\js\3D\writers\SQLWriter.js
**Description:** This file implements a writer for generating SQL (Structured Query Language) scripts, likely for inserting or updating 3D model data into a database.

### Functions/Methods:
- `SQLWriter(SQLWriter)`: Constructor for an SQL script writer.
- `write(out)`: Writes SQL statements to the specified output.
- `export(SQLWriter)`: Exports the SQLWriter class.

## File: src\js\3D\writers\OBJWriter.js
**Description:** This file implements a writer for OBJ (Object) files, a popular geometry definition file format for 3D graphics.

### Functions/Methods:
- `OBJWriter(OBJWriter)`: Constructor for an OBJ file writer.
- `write(out)`: Writes 3D model data to an OBJ file format.
- `export(OBJWriter)`: Exports the OBJWriter class.

## File: src\js\3D\writers\MTLWriter.js
**Description:** This file implements a writer for MTL (Material Template Library) files, which are companion files to OBJ models that define material properties.

### Functions/Methods:
- `MTLWriter(MTLWriter)`: Constructor for an MTL file writer.
- `write(out)`: Writes material definitions to an MTL file format.
- `export(MTLWriter)`: Exports the MTLWriter class.

## File: src\js\3D\writers\JSONWriter.js
**Description:** This file implements a writer for generating JSON (JavaScript Object Notation) files, typically used for exporting structured data related to 3D models.

### Functions/Methods:
- `JSONWriter(JSONWriter)`: Constructor for a JSON file writer.
- `write(out)`: Writes structured data to a JSON file format.
- `export(JSONWriter)`: Exports the JSONWriter class.

## File: src\js\3D\writers\GLTFWriter.js
**Description:** This file implements a writer for glTF (GL Transmission Format) files, a royalty-free specification for the efficient transmission and loading of 3D scenes and models.

### Functions/Methods:
- `GLTFWriter(GLTFWriter)`: Constructor for a glTF file writer.
- `write(out)`: Writes 3D scene data to a glTF file format.
- `export(GLTFWriter)`: Exports the GLTFWriter class.

## File: src\js\3D\writers\GLBWriter.js
**Description:** This file implements a writer for GLB (Binary glTF) files, the binary container format for glTF that can include 3D model data, textures, and animations in a single file.

### Functions/Methods:
- `GLBWriter(GLBWriter)`: Constructor for a GLB file writer.
- `write(out)`: Writes 3D scene data to a GLB (binary glTF) file format.
- `export(GLBWriter)`: Exports the GLBWriter class.

## File: src\js\3D\writers\CSVWriter.js
**Description:** This file implements a writer for generating CSV (Comma Separated Values) files, typically used for exporting tabular data related to 3D models or other assets.

### Functions/Methods:
- `CSVWriter(CSVWriter)`: Constructor for a CSV file writer.
- `write(out)`: Writes tabular data to a CSV file format.
- `export(CSVWriter)`: Exports the CSVWriter class.

## File: src\js\3D\renderers\WMORendererGL.js
**Description:** This file implements a WebGL renderer specifically for WMO (World Model Object) 3D models, handling their rendering within a graphical context.

### Functions/Methods:
- `WMORendererGL(WMORendererGL)`: Constructor for a WMO WebGL renderer.
- `render(scene)`: Renders the WMO model within the specified 3D scene.
- `export(WMORendererGL)`: Exports the WMORendererGL class.

## File: src\js\3D\renderers\WMOLegacyRendererGL.js
**Description:** This file implements a WebGL renderer specifically for legacy WMO (World Model Object) 3D models, handling their rendering for older formats.

### Functions/Methods:
- `WMOLegacyRendererGL(WMOLegacyRendererGL)`: Constructor for a legacy WMO WebGL renderer.
- `render(scene)`: Renders the legacy WMO model within the specified 3D scene.
- `export(WMOLegacyRendererGL)`: Exports the WMOLegacyRendererGL class.

## File: src\js\3D\renderers\ShadowPlaneRenderer.js
**Description:** This file implements a WebGL renderer for drawing shadow planes, which are typically used to cast simple shadows in 3D scenes.

### Functions/Methods:
- `ShadowPlaneRenderer(ShadowPlaneRenderer)`: Constructor for a shadow plane WebGL renderer.
- `render(scene)`: Renders the shadow plane within the specified 3D scene.
- `export(ShadowPlaneRenderer)`: Exports the ShadowPlaneRenderer class.

## File: src\js\3D\renderers\MDXRendererGL.js
**Description:** This file implements a WebGL renderer specifically for MDX (Mageia 3D X) 3D models, handling their rendering within a graphical context.

### Functions/Methods:
- `MDXRendererGL(MDXRendererGL)`: Constructor for an MDX WebGL renderer.
- `render(scene)`: Renders the MDX model within the specified 3D scene.
- `export(MDXRendererGL)`: Exports the MDXRendererGL class.

## File: src\js\3D\renderers\M3RendererGL.js
**Description:** This file implements a WebGL renderer specifically for M3 (Model 3) 3D models, handling their rendering within a graphical context.

### Functions/Methods:
- `M3RendererGL(M3RendererGL)`: Constructor for an M3 WebGL renderer.
- `render(scene)`: Renders the M3 model within the specified 3D scene.
- `export(M3RendererGL)`: Exports the M3RendererGL class.

## File: src\js\3D\renderers\M2RendererGL.js
**Description:** This file implements a WebGL renderer specifically for M2 (Model 2) 3D models, handling their rendering within a graphical context.

### Functions/Methods:
- `M2RendererGL(M2RendererGL)`: Constructor for an M2 WebGL renderer.
- `render(scene)`: Renders the M2 model within the specified 3D scene.
- `export(M2RendererGL)`: Exports the M2RendererGL class.

## File: src\js\3D\renderers\M2LegacyRendererGL.js
**Description:** This file implements a WebGL renderer specifically for legacy M2 (Model 2) 3D models, handling their rendering for older formats.

### Functions/Methods:
- `M2LegacyRendererGL(M2LegacyRendererGL)`: Constructor for a legacy M2 WebGL renderer.
- `render(scene)`: Renders the legacy M2 model within the specified 3D scene.
- `export(M2LegacyRendererGL)`: Exports the M2LegacyRendererGL class.

## File: src\js\3D\renderers\GridRenderer.js
**Description:** This file implements a WebGL renderer for drawing a 3D grid, commonly used as a visual aid in 3D editors or viewers.

### Functions/Methods:
- `GridRenderer(GridRenderer)`: Constructor for a grid WebGL renderer.
- `render(scene)`: Renders the 3D grid within the specified scene.
- `export(GridRenderer)`: Exports the GridRenderer class.

## File: src\js\3D\renderers\CharMaterialRenderer.js
**Description:** This file implements a WebGL renderer for character materials, handling how character-specific textures and properties are displayed in a 3D environment.

### Functions/Methods:
- `CharMaterialRenderer(CharMaterialRenderer)`: Constructor for a character material WebGL renderer.
- `render(scene)`: Renders character materials within the specified 3D scene.
- `export(CharMaterialRenderer)`: Exports the CharMaterialRenderer class.

## File: src\js\3D\loaders\WMOLoader.js
**Description:** This file implements a loader for WMO (World Model Object) 3D models, responsible for parsing and preparing WMO data for rendering.

### Functions/Methods:
- `WMOLoader(WMOLoader)`: Constructor for a WMO model loader.
- `load(file)`: Loads and parses WMO model data from a file.
- `export(WMOLoader)`: Exports the WMOLoader class.

## File: src\js\3D\loaders\WMOLegacyLoader.js
**Description:** This file implements a loader for legacy WMO (World Model Object) 3D models, responsible for parsing and preparing older WMO data formats for rendering.

### Functions/Methods:
- `WMOLegacyLoader(WMOLegacyLoader)`: Constructor for a legacy WMO model loader.
- `load(file)`: Loads and parses legacy WMO model data from a file.
- `export(WMOLegacyLoader)`: Exports the WMOLegacyLoader class.

## File: src\js\3D\loaders\WDTLoader.js
**Description:** This file implements a loader for WDT (World Map Table) files, which define the structure and layout of World of Warcraft maps.

### Functions/Methods:
- `WDTLoader(WDTLoader)`: Constructor for a WDT file loader.
- `load(file)`: Loads and parses WDT file data.
- `export(WDTLoader)`: Exports the WDTLoader class.

## File: src\js\3D\loaders\SKELLoader.js
**Description:** This file implements a loader for skeletal animation data, typically used to animate 3D models.

### Functions/Methods:
- `SKELLoader(SKELLoader)`: Constructor for a skeletal animation loader.
- `load(file)`: Loads and parses skeletal animation data from a file.
- `export(SKELLoader)`: Exports the SKELLoader class.

## File: src\js\3D\loaders\MDXLoader.js
**Description:** This file implements a loader for MDX (Mageia 3D X) 3D models, responsible for parsing and preparing MDX data for rendering.

### Functions/Methods:
- `MDXLoader(MDXLoader)`: Constructor for an MDX model loader.
- `load(file)`: Loads and parses MDX model data from a file.
- `export(MDXLoader)`: Exports the MDXLoader class.

## File: src\js\3D\loaders\M3Loader.js
**Description:** This file implements a loader for M3 (Model 3) 3D models, responsible for parsing and preparing M3 data for rendering.

### Functions/Methods:
- `M3Loader(M3Loader)`: Constructor for an M3 model loader.
- `load(file)`: Loads and parses M3 model data from a file.
- `export(M3Loader)`: Exports the M3Loader class.

## File: src\js\3D\loaders\M2Loader.js
**Description:** This file implements a loader for M2 (Model 2) 3D models, responsible for parsing and preparing M2 data for rendering.

### Functions/Methods:
- `M2Loader(M2Loader)`: Constructor for an M2 model loader.
- `load(file)`: Loads and parses M2 model data from a file.
- `export(M2Loader)`: Exports the M2Loader class.

## File: src\js\3D\loaders\M2LegacyLoader.js
**Description:** This file implements a loader for legacy M2 (Model 2) 3D models, responsible for parsing and preparing older M2 data formats for rendering.

### Functions/Methods:
- `M2LegacyLoader(M2LegacyLoader)`: Constructor for a legacy M2 model loader.
- `load(file)`: Loads and parses legacy M2 model data from a file.
- `export(M2LegacyLoader)`: Exports the M2LegacyLoader class.

## File: src\js\3D\loaders\M2Generics.js
**Description:** This file provides generic utility functions specifically for handling M2 (Model 2) 3D models, such as determining render masks for geosets.

### Functions/Methods:
- `getGeosetRenderMask(geoset)`: Retrieves the render mask for a given geoset in an M2 model.
- `export(getGeosetRenderMask)`: Exports the function to get the geoset render mask.

## File: src\js\3D\loaders\LoaderGenerics.js
**Description:** This file provides generic utility functions applicable across various 3D model loaders, such as common data processing routines.

### Functions/Methods:
- `process(data)`: Processes generic data, likely performing common operations required by 3D model loaders.
- `export(process)`: Exports the generic data processing function.

## File: src\js\3D\loaders\BONELoader.js
**Description:** This file implements a loader for bone data, which defines the skeletal structure used for animating 3D models.

### Functions/Methods:
- `BONELoader(BONELoader)`: Constructor for a bone data loader.
- `load(file)`: Loads and parses bone data from a file.
- `export(BONELoader)`: Exports the BONELoader class.

## File: src\js\3D\loaders\ANIMLoader.js
**Description:** This file implements a loader for animation data, used to define how 3D models move over time.

### Functions/Methods:
- `ANIMLoader(ANIMLoader)`: Constructor for an animation data loader.
- `load(file)`: Loads and parses animation data from a file.
- `export(ANIMLoader)`: Exports the ANIMLoader class.

## File: src\js\3D\loaders\ADTLoader.js
**Description:** This file implements a loader for ADT (Azeroth Dungeon Terrain) files, which define terrain and environmental data for World of Warcraft zones.

### Functions/Methods:
- `ADTLoader(ADTLoader)`: Constructor for an ADT file loader.
- `load(file)`: Loads and parses ADT file data.
- `export(ADTLoader)`: Exports the ADTLoader class.

## File: src\js\3D\gl\VertexArray.js
**Description:** This file encapsulates WebGL Vertex Array Object (VAO) functionality, managing vertex attributes and buffer configurations for rendering 3D graphics.

### Functions/Methods:
- `VertexArray(VertexArray)`: Constructor for a WebGL Vertex Array Object wrapper.
- `bind()`: Binds the Vertex Array Object, making it active for subsequent vertex attribute operations.
- `unbind()`: Unbinds the currently active Vertex Array Object.
- `addBuffer(buffer, layout)`: Adds a vertex buffer to the VAO and configures its attribute layout.
- `export(VertexArray)`: Exports the VertexArray class.

## File: src\js\3D\gl\UniformBuffer.js
**Description:** This file encapsulates WebGL Uniform Buffer Object (UBO) functionality, allowing for efficient management and updating of uniform data for shaders.

### Functions/Methods:
- `UniformBuffer(UniformBuffer)`: Constructor for a WebGL Uniform Buffer Object wrapper.
- `bind()`: Binds the Uniform Buffer Object, making it active.
- `unbind()`: Unbinds the currently active Uniform Buffer Object.
- `setData(data)`: Updates the data stored in the Uniform Buffer Object.
- `export(UniformBuffer)`: Exports the UniformBuffer class.

## File: src\js\3D\gl\ShaderProgram.js
**Description:** This file encapsulates WebGL Shader Program functionality, managing the compilation and linking of vertex and fragment shaders into a runnable program.

### Functions/Methods:
- `ShaderProgram(ShaderProgram)`: Constructor for a WebGL Shader Program wrapper.
- `compileShader(type, source)`: Compiles a single shader (vertex or fragment) from source code.
- `use()`: Activates the shader program for rendering.
- `unuse()`: Deactivates the shader program.
- `getUniformLocation(name)`: Retrieves the memory location of a uniform variable within the shader program.
- `setUniform(name, value)`: Sets the value of a uniform variable within the shader program.
- `export(ShaderProgram)`: Exports the ShaderProgram class.

## File: src\js\3D\gl\GLTexture.js
**Description:** This file encapsulates WebGL Texture functionality, managing the creation, binding, and updating of 2D textures for use in 3D rendering.

### Functions/Methods:
- `GLTexture(GLTexture)`: Constructor for a WebGL Texture wrapper.
- `bind()`: Binds the texture, making it active for rendering.
- `unbind()`: Unbinds the currently active texture.
- `setData(data)`: Updates the image data of the texture.
- `export(GLTexture)`: Exports the GLTexture class.

## File: src\js\3D\gl\GLContext.js
**Description:** This file manages the WebGL rendering context, providing utilities for initialization, viewport configuration, clearing, and other context-related operations.

### Functions/Methods:
- `GLContext(GLContext)`: Constructor for a WebGL rendering context wrapper.
- `getContext()`: Retrieves the underlying WebGL rendering context.
- `getCanvas()`: Retrieves the HTML canvas element associated with the WebGL context.
- `makeCurrent()`: Makes this WebGL context the currently active one.
- `clear()`: Clears the color and depth buffers of the WebGL context.
- `setViewport(x, y, width, height)`: Sets the viewport dimensions for rendering.
- `setClearColor(r, g, b, a)`: Sets the color used to clear the color buffer.
- `export(GLContext)`: Exports the GLContext class.

## File: src\js\3D\exporters\WMOLegacyExporter.js
**Description:** This file implements an exporter for legacy WMO (World Model Object) 3D models, converting them into a format suitable for external use or storage.

### Functions/Methods:
- `WMOLegacyExporter(WMOLegacyExporter)`: Constructor for a legacy WMO model exporter.
- `export(model)`: Exports the given legacy WMO model.
- `export(WMOLegacyExporter)`: Exports the WMOLegacyExporter class.

## File: src\js\3D\exporters\WMOExporter.js
**Description:** This file implements an exporter for WMO (World Model Object) 3D models, converting them into a format suitable for external use or storage.

### Functions/Methods:
- `WMOExporter(WMOExporter)`: Constructor for a WMO model exporter.
- `export(model)`: Exports the given WMO model.
- `export(WMOExporter)`: Exports the WMOExporter class.

## File: src\js\3D\exporters\M3Exporter.js
**Description:** This file implements an exporter for M3 (Model 3) 3D models, converting them into a format suitable for external use or storage.

### Functions/Methods:
- `M3Exporter(M3Exporter)`: Constructor for an M3 model exporter.
- `export(model)`: Exports the given M3 model.
- `export(M3Exporter)`: Exports the M3Exporter class.

## File: src\js\3D\exporters\M2LegacyExporter.js
**Description:** This file implements an exporter for legacy M2 (Model 2) 3D models, converting older M2 data formats into a format suitable for external use or storage.

### Functions/Methods:
- `M2LegacyExporter(M2LegacyExporter)`: Constructor for a legacy M2 model exporter.
- `export(model)`: Exports the given legacy M2 model.
- `export(M2LegacyExporter)`: Exports the M2LegacyExporter class.

## File: src\js\3D\exporters\M2Exporter.js
**Description:** This file implements an exporter for M2 (Model 2) 3D models, converting them into a format suitable for external use or storage.

### Functions/Methods:
- `M2Exporter(M2Exporter)`: Constructor for an M2 model exporter.
- `export(model)`: Exports the given M2 model.
- `export(M2Exporter)`: Exports the M2Exporter class.

## File: src\js\3D\exporters\CharacterExporter.js
**Description:** This file implements an exporter specifically for character 3D models, handling the extraction and conversion of character-related assets.

### Functions/Methods:
- `CharacterExporter(CharacterExporter)`: Constructor for a character model exporter.
- `export(model)`: Exports the given character model.
- `export(CharacterExporter)`: Exports the CharacterExporter class.

## File: src\js\3D\exporters\ADTExporter.js
**Description:** This file implements an exporter for ADT (Azeroth Dungeon Terrain) files, converting terrain and environmental data into a format suitable for external use.

### Functions/Methods:
- `ADTExporter(ADTExporter)`: Constructor for an ADT file exporter.
- `export(model)`: Exports the given ADT terrain model.
- `export(ADTExporter)`: Exports the ADTExporter class.

## File: src\js\3D\camera\CharacterCameraControlsGL.js
**Description:** This file defines WebGL camera controls specifically tailored for character viewing, allowing interaction with the camera around a character model.

### Functions/Methods:
- `CharacterCameraControlsGL(CharacterCameraControlsGL)`: Constructor for character-centric camera controls.
- `update()`: Updates the camera's position and orientation based on user input or animation.
- `export(CharacterCameraControlsGL)`: Exports the CharacterCameraControlsGL class.

## File: src\js\3D\camera\CameraControlsGL.js
**Description:** This file defines generic WebGL camera controls, providing functionality for interacting with a 3D camera in a graphical environment.

### Functions/Methods:
- `CameraControlsGL(CameraControlsGL)`: Constructor for generic WebGL camera controls.
- `update()`: Updates the camera's position and orientation based on user input.
- `export(CameraControlsGL)`: Exports the CameraControlsGL class.

## File: src\js\3D\WMOShaderMapper.js
**Description:** This file maps WMO (World Model Object) material properties to appropriate shader programs for rendering in WebGL.

### Functions/Methods:
- `WMOShaderMapper(WMOShaderMapper)`: Constructor for a WMO shader mapper.
- `getShader(material)`: Retrieves the correct shader program for a given WMO material.
- `export(WMOShaderMapper)`: Exports the WMOShaderMapper class.

## File: src\js\3D\Texture.js
**Description:** This file represents a 3D texture object, managing its properties, loading from files, and preparing it for use in WebGL rendering.

### Functions/Methods:
- `Texture(Texture)`: Constructor for a 3D Texture object.
- `load(file)`: Loads texture data from a file.
- `export(Texture)`: Exports the Texture class.

## File: src\js\3D\Skin.js
**Description:** This file represents a 3D model skin, managing its properties and loading from skin files, typically associated with animated character models.

### Functions/Methods:
- `Skin(Skin)`: Constructor for a 3D model Skin object.
- `load(file)`: Loads skin data from a file.
- `export(Skin)`: Exports the Skin class.

## File: src\js\3D\Shaders.js
**Description:** This file provides utilities for managing and retrieving shader programs used in 3D rendering, acting as a central registry for available shaders.

### Functions/Methods:
- `getShader(name)`: Retrieves a specific shader program by its name.
- `export(getShader)`: Exports the function to get shader programs.

## File: src\js\3D\ShaderMapper.js
**Description:** This file maps material properties or shader names to actual WebGL shader programs, facilitating dynamic shader selection during rendering.

### Functions/Methods:
- `ShaderMapper(ShaderMapper)`: Constructor for a shader mapper.
- `getShader(shaderName)`: Retrieves the appropriate shader program based on a shader name or material properties.
- `export(ShaderMapper)`: Exports the ShaderMapper class.

## File: src\js\3D\GeosetMapper.js
**Description:** This file maps geoset IDs to descriptive names, aiding in the identification and selection of specific geometric sets within 3D models.

### Functions/Methods:
- `GeosetMapper(GeosetMapper)`: Constructor for a geoset mapper.
- `getGeosetName(geosetID)`: Retrieves the human-readable name for a given geoset ID.
- `export(GeosetMapper)`: Exports the GeosetMapper class.

## File: src\js\3D\BoneMapper.js
**Description:** This file maps bone IDs to descriptive names, aiding in the identification and selection of specific bones within 3D model skeletons.

### Functions/Methods:
- `BoneMapper(BoneMapper)`: Constructor for a bone mapper.
- `getBoneName(boneID)`: Retrieves the human-readable name for a given bone ID.
- `export(BoneMapper)`: Exports the BoneMapper class.

## File: src\js\3D\AnimMapper.js
**Description:** This file maps animation IDs to descriptive names, aiding in the identification and selection of specific animations for 3D models.

### Functions/Methods:
- `AnimMapper(AnimMapper)`: Constructor for an animation mapper.
- `getAnimName(animID)`: Retrieves the human-readable name for a given animation ID.
- `export(AnimMapper)`: Exports the AnimMapper class.

## File: src\app.js
**Description:** This file serves as the main entry point and core application logic for the `wow.export` application, initiating various components and processes.

### Functions/Methods:
- `init()`: Initializes the main application components and settings.
- `run()`: Starts the main execution loop or processes of the application.

## File: publish.js
**Description:** This script handles the automated publishing process of application builds, likely involving packaging, uploading, and versioning.

### Functions/Methods:
- No user-defined functions found in this script.

## File: node_addons\mmap\src\mmap_wrapper.h
**Description:** This header file declares the interface for `MMAP_Wrapper` functionality, providing methods for memory-mapped file operations in C++.

### Functions/Methods:
- `MMAP_Wrapper()`: Constructor for the MMAP_Wrapper class.
- `open(path, size)`: Opens a file as a memory-mapped region with a specified size.
- `close()`: Closes the memory-mapped file.
- `read(offset, size)`: Reads data from the memory-mapped region at a given offset and size.

## File: node_addons\mmap\src\mmap_wrapper.cpp
**Description:** This C++ file implements the `MMAP_Wrapper` class, providing native functionality for memory-mapped file operations, which can be exposed to Node.js.

### Functions/Methods:
- `MMAP_Wrapper()`: Constructor for the MMAP_Wrapper class.
- `New(args)`: Node.js N-API function to create a new instance of MMAP_Wrapper.
- `Open(args)`: Node.js N-API function to open a memory-mapped file.
- `Close(args)`: Node.js N-API function to close a memory-mapped file.
- `Read(args)`: Node.js N-API function to read from a memory-mapped file.
- `Init(exports)`: Node.js N-API function to initialize the module and expose MMAP_Wrapper methods.

## File: node_addons\mmap\src\mmap_addon.cpp
**Description:** This C++ file serves as the entry point for the native Node.js addon for memory-mapped file operations, registering the module with Node.js.

### Functions/Methods:
- `NODE_MODULE(mmap_addon, Init)`: Macro that registers the `mmap_addon` module with Node.js, calling the `Init` function upon loading.

## File: installer\installer.js
**Description:** This script manages the application's installation process, including downloading necessary files, verifying the installation, and handling initial setup.

### Functions/Methods:
- `downloadFile(url, dest)`: Downloads a file from a URL to a specified destination during installation.
- `verifyInstall()`: Verifies the integrity and completeness of the application installation.
- `install()`: Initiates the main installation routine for the application.
- `main()`: The main entry point for the installer script.

## File: build\log.js
**Description:** This file provides simple logging functions for the build process, allowing messages to be written to a log file or console.

### Functions/Methods:
- `write(content)`: Writes general content to the build log.
- `log(content)`: Logs an informational message during the build process.
- `warn(content)`: Logs a warning message during the build process.
- `error(content)`: Logs an error message during the build process.

## File: build\build-native-addons.js
**Description:** This script automates the process of building native Node.js addons required by the application, ensuring they are compiled for the correct environment.

### Functions/Methods:
- `buildAddon(addonPath)`: Builds a native Node.js addon located at the specified path.
- `main()`: The main entry point for the native addon build script.

## File: build.js
**Description:** This script orchestrates the overall build process for the application, likely invoking other build-related tasks and managing dependencies.

### Functions/Methods:
- `main()`: The main entry point for the application's build script.

## File: addons\blender\io_scene_wowobj\import_wowobj.py
**Description:** This Python script provides functionality to import `.wowobj` files into Blender, likely used for loading World of Warcraft 3D models.

### Functions/Methods:
- `execute(context)`: Executes the import operation within the Blender context.
- `draw(context)`: Draws UI elements for the import operator in Blender.
- `invoke(context, event)`: Invokes the import operator in Blender, handling events.

## File: addons\blender\io_scene_wowobj\__init__.py
**Description:** This Python script serves as the initialization file for the Blender addon, registering its operators, panels, and other components.

### Functions/Methods:
- `register()`: Registers the Blender addon components (operators, panels, etc.).
- `unregister()`: Unregisters the Blender addon components.

## File: addons\blender\io_scene_wowobj\animation_processor.py
**Description:** This Python script processes animation data within Blender, likely used to prepare or manipulate animations imported from `.wowobj` files.

### Functions/Methods:
- `process_animation(armature, action)`: Processes animation data for a given armature and action in Blender.
