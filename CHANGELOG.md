0.1.65 (31-12-2024)
- Added option to view and export texture atlas regions from the texture viewer.
- Added support for newer root manifest format introduced 11.1+.
- Added patch region for China.

0.1.64 (21-07-2024)
- Fix issue with exports not starting for some users due to an issue introduced in 0.1.62.

0.1.63 (20-07-2024)
- Added more verbose logging for required downloads during loading to hopefully figure out why some users are having issues.

0.1.62 (19-07-2024)
- Added warning for users who set the last export file as a directory.
- Fixed issue with raw map exports skipping certain WMOs.

0.1.61 (16-07-2024)
- Fixed issue with raw WMO exports failing due to missing LOD groups.

0.1.60 (15-07-2024)
- Added exporting of .skel files and files referenced by .skel files for raw M2 exports.
- Added exporting of WMO LOD groups for raw WMO exports.
- Added exporting of other WDT files for raw map exports.
- Added option to blend the terrain textures from the exported alpha maps in the Blender add-on.
- Improved blending on some character textures.
- Improved memory usage for WMO previewing and exporting.
- Improved CASC loading to fall back to CDN for missing config files.
- Fixed missing map name from raw ADT export filenames.
- Fixed missing bone data from OBJ exports with bone JSON exports enabled.
- Fixed issue where filtering textures by items would only show textures for one gender.
- Fixed issue with alpha maps from early maps such as Emerald Dream being exported incorrectly.
- Fixed issue causing seams to appear on baked character textures.
- Fixed issue with character tab layout being unusable on higher display sizes.
- Fixed issue that caused character texture overlay to stop appearing after changing tabs.
- Fixed issue that caused geoset control in the Models and Character tabs to be linked.
- Fixed issue that caused wow.export to run out of memory when exporting incredibly large WMOs.

0.1.59 (29-02-2024)
- Initial support for exporting textured character models and their customizations to glTF. Some customizations are not yet supported.
  Note: Please see the pinned issue on top of our GitHub issues page for known issues/requests before reporting a bug/making a suggestion.
- New and improved 3D camera controls in the model viewer.
- Holding SHIFT and ALT now allows for more precise camera movement.
- Fixed missing animations on models that share rigs (e.g. void elf/upright orc/nightborne).
- Added expansion icon for The War Within.
- Improved default geoset selection.

0.1.58 (11-02-2024)
- M2 models can now be exported with all their animations when using glTF. (Beta feature)
- Added additional bone names for non-keybone bones.
- Added optional setting (disabled by default) to also display unnamed/unknown items in the "Items" tab.
- Added exporting of all doodads when exporting raw WMOs.
- Fixed alpha channels not decoding correctly on some BLPs.
- Fixed skin names appearing in raw export filenames for M2s.
- Improved performance when loading models for previewing while "Show Textures" is disabled.
  Note: When enabling the "Show Textures" checkbox a reload of the model is needed for textures to appear.

0.1.57 (25-01-2024)
- M2 models can now be exported in the glTF format (complete with armature)! 🎉
- WMO models can now be exported in glTF format (does not support doodads).
- Fixed issue with models added since 9.2+ not containing names.

⭐ [Special thank you to Kathen for contributions in 0.1.57]

0.1.56 (20-01-2024)
- Blender add-on fix (make sure to update the addon).

0.1.55 (19-01-2024)
- Updated default listfile, encryption key and data definition downloads to come from GitHub.
- Fixed fallbacks for listfile, encryption key and data definition downloads.
- Fixed long material names crashing Blender imports (make sure to update the addon).
- Fixed unnecessary log message always being logged during listfile parsing.

0.1.54 (09-12-2023)
- Fixed loading of 10.2.5 installations by adding WDC5 support for DB2 files.

0.1.53 (05-12-2023)
- Fixed an issue that caused wow.export to crash on startup.

0.1.52 (05-12-2023)
- Updated add-on to support Blender 4.0.

0.1.51 (25-09-2023)
- Added fallback URLs for listfile, encryption key and data definition downloads.
- Added support for HTTP 302 redirects when downloading files.
- Added logging of listfile download failure reason.

0.1.50 (17-08-2023)
- Fixed loading of 10.1.7 installations after Blizzard changed something.

0.1.49 (23-05-2023)
- Added mainline PTR 2 to the product list.
- Added file type detection for .anim (2x), .bls, .tex, .avi and .db2.
- Added exporting of OBJ1/LOD ADT files for raw map exports.
- Fixed an issue that broke unknown file type detection in the raw files tab.
- Fixed an issue where unknown files would fail to export.

0.1.48 (10-03-2023)
- Adds preliminary support for reading DB2 tables in 10.1+.

0.1.47 (23-01-2023)
- Fixes an issue with DB2 reading for certain DB2 tables.

0.1.46 (23-01-2023)
- Fixes an issue that causes M2 models exported as part of an ADT to have the wrong file extension.
- Removed China as a supported region, as the CDN is no longer available.

0.1.45 (22-01-2023)
- Updated to support World of Warcraft v10.0.5+ and v3.4.1+.
- The "Textures" option for map tile exporting is now enabled by default.
- Improved load times when previewing large WMO models.
- The following breaking changes have been made to raw M2 exporting to keep it consistent with the other export systems:
	- `.skin` files are now named as they appear on the community listfile instead of `{skinName}.skin`. If the fileDataID does not appear on the listfile, `unknown/{fileDataID}.skin` will be used.
	- `.skel` files are now named as they appear on the community listfile instead of `{modelName}.skel`. If the fileDataID does not appear on the listfile, `unknown/{fileDataID}.skel` will be used.
	- `.bone` files are now named as they appear on the community listfile instead of `{modelName}_{X}.bone`. If the fileDataID does not appear on the listfile, `unknown/{fileDataID}.bone` will be used.
	- `.anim` files are now named as they appear on the community listfile instead of `{modelName}{animID}-{animSubID}.anim`. If the fileDataID does not appear on the listfile, `unknown/{fileDataID}.anim` will be used.
	- Raw `.skin`, `.skel`, `.bone` and `.anim` files exported with M2 models now respect the "Enable Shared Children" option and will be exported accordingly.
	- Raw M2 models will now be exported with a manifest file `{modelName}.manifest.json` which contains metadata about any associated files that were exported with it (textures, bones, skins, etc).
- Added ability to export complete ADT tiles as raw client files.
- Fixed issue that prevented unknown sound files from being auto-detected in "Browse Raw Client Files".
- Fixed exporting of WMO MLIQ data.
- Fixed an issue that caused models to export with incorrect names when exporting multiple models at once.
- Fixed issue that would prevent the "Clear Cache" button in settings to work under certain circumstances.
- Fixed various issues that would prevent certain DB2 files from being read.
- Fixed issue that prevented map tile exporting when "Enable Shared Children" is disabled.
- Fixed an issue where strings from decrypted DB2 data could be corrupt.

0.1.44 (24-10-2022)
- Added preview and export support for new texture references used in some Dragonflight WMOs.
- Added expansion icon for Dragonflight.
- Added Classic Era (1.14) to product list.
- Fixed an issue where DB2s could not be exported as raw client files.

0.1.43 (29-05-2022)
- Added ability to click + drag when selecting map tiles, making large selections much quicker.
- Added a "Copy to Clipboard" button for the model-viewer, allowing the 3D preview to be directly copied to the clipboard without needing to export, complete with transparency.
- Added a "Copy to Clipboard" button to the texture tab, allowing the currently active  texture to be copied clipboard without needing to export, complete with transparency.
- Added a "Copy to Clipboard" button for the text/script viewer.
- Added the 'View in Explorer' option to the toast menu when exporting PNG previews for 3D models.
- Added 'Preview' option to model viewer texture ribbon, allowing textures to be previewed without switching to the textures tab.
- Added fog data (MFOG) to the advanced meta-data WMO exports under the fog property.
- Added 'Display File Lists in Numerical Order' option to order by file data ID instead of alphabetically by filename.
- Added 'Browse Install Manifest' feature to the right-hand navigation drop-down menu, allowing browsing/exporting of all installation (binary, executable, etc) files for the loaded game client.
- Added 'Browse Raw Client Files' feature to the right-hand navigation drop-down menu, allowing browsing/exporting of all files in the loaded game client.
- Added button to auto-detect file types for unknown files, found on the 'Browse Raw Client Files' screen.
- Added 'Enable Shared Children' option in settings, which can be disabled so that objects within a WMO/ADT are exported into the output directory of the originally selected object instead of to their own directories.
- Added 'Last Export File Location' option to control where the export manifest is written.
- Added MLIQ (liquid) data to WMO JSON data for advanced users (see https://wowdev.wiki/WMO#MLIQ_chunk).
- Fixed an issue that prevented the first texture for an M2 model from showing on the 3D preview texture ribbon.
- Fixed an issue that caused the PNG preview export for 3D models to display the wrong path in the log/toast.
- Fixed a memory issue with PNG writing which should improve performance during exports.
- Fixed an issue that would cause the application to run out of memory and crash when exporting high-resolution textures, or models that included such textures.
- Fixed an issue which caused WMO models to sometimes show the wrong textures in the 3D preview.
- Fixed numerous internal issues related to parsing data tables.
- Fixed an issue that would cause the M2/WMO filtering to break when toggling file data ID visibility.
- Fixed an issue that caused .skel/.bone files included in M2 raw exports to incorrectly include the .m2 file extension.
- Replaced the default Data Table Definition Repository URL with a proxy in the interest of users in China, where GitHub is firewalled.
- Unknown sound, BLP and M2 files dynamically found via data-table scanning will now be placed on file lists as unknown/<id>.<ext> instead of `unknown_<id>.<ext>`.
- Exporting a raw M2 file with the .skin file option enabled will now also export LOD skin files.
- The texture ribbon on the 3D model viewer will now show associated textures for models that have no 3D geometry associated, such as spells.
- Adjusted a number of error messages to provide more helpful information.
- Removed the buttons to view textures/maps on the wow.tools website.
- Features previously accessed via buttons on the right-hand side of the main navigation menu have been consolidated into a single dedicated button found in the same location.
- Implemented numerous tweaks to the visual design of wow.export.
- The default window size of wow.export has been changed to 1370x988.
- Renamed the 'wow_classic_beta' branch to 'Beta: World of Warcraft Classic' with the tag 'Classic Beta'.
- Renamed the 'wow_classic_ptr' branch to 'PTR: World of Warcraft Classic' with the tag 'Classic PTR'.

0.1.42 (12-03-2022)
- wow.export now has a new website located at https://www.kruithne.net/wow.export/
- By default, listfiles will now be downloaded from https://www.kruithne.net/wow.export/data/listfile/master
- By default, TACT encryption keys will now be downloaded from https://www.kruithne.net/wow.export/data/tact/wow
- Files do not exist in the loaded game installation will no longer appear in file lists.

0.1.41 (16-01-2022)
- Added `ambientColor` field to WMO groups in JSON metadata (MDAL).

0.1.40 (20-10-2021)
- Added vertex colour data to ADT export meta JSON.
- Added texture height scale/offset to alpha map meta exports.
- Fixed missing fileDataID column in CSV placement file for ADT exports.
- Fixed issue that caused missing data in merged alpha map exports.
- Fixed issue that prevented M2 .skel files from exporting in raw exports.
- Fixed issue that caused navigation issues from the Blender add-on screen.

0.1.39 (14-09-2021)
- Added option to export M2 bone data into a relative *_bones.json file.
- Added an `exportID` property to `EXPORT_` and `HOOK_EXPORT_COMPLETE` RCP messages.
- M2 models exported with a skin will now be named uniquely based on the selected skin.
- Fixed issue with texture ribbon being overwritten by M2 textures when viewing a WMO.

0.1.38 (13-09-2021)
- Implemented remote control protocol for advanced users.
- Regular expression matching is now case-insensitive.
- Fixed issue that prevented certain models from rendering while the texture ribbon is active.

0.1.37 (01-09-2021)
- Added texture ribbon to the 3D model viewer, allowing inspection of used textures.
- Added ability to copy item names/IDs to the clipboard from the item browser.
- Added ability to view items on Wowhead (external) from the item browser.
- Added button to open maps externally in wow.tools (external) on the map viewer.
- Texture viewer will now export the previewed texture if no user selection has been made.
- Selecting textures/models for an item will now reset the respective filter.
- Consolidated option to view item models/textures into a context menu.
- Removed buttons to toggle sidebar visibility; sidebar is now always visible.
- Changed Discord links in the footer/crash screen to point to new support location.

0.1.36 (31-08-2021)
- Added `colors` property to M2 metadata containing color/alpha timelines for models.
- Added `textureWeights` property to M2 metadata containing global texture transparency timelines for models.
- Added `transparencyLookup` property to M2 metadata for texture unit mapping to transparency entries.
- Added `textureTransforms` property to M2 metadata defining texture animation timelines.
- Added `textureTransformsLookup` property to M2 metadata for texture transform lookups.
- Added `skin.fileName` and `skin.fileDataID` properties to M2 skin metadata.
- Added `boundingBox`, `boundingSphereRadius`, `collisionBox`, `collisionSphereRadius` properties to M2 metadata.
- Added `animFileIDs` property to M2 metadata mapping animation IDs to relative `.anim` files.
- Added option to export all associated raw `.anim` files with M2 models.
- Added option to export liquid (water, lava, etc) data for ADT tiles.

0.1.35 (30-08-2021)
- Fixed issue that caused invalid OBJ files to be produced for M2 collision geometry.
- Added `skin.subMeshes.enabled` property to M2 metadata, indicating which sub-meshes were exported.
- Added `groups.enabled` property to WMO metadata, indicating which WMO groups were exported.
- Added `textures.fileNameInternal` property to M2 metadata, mapping fileDataID to a listfile entry.
- Added `textures.fileNameExternal` property to M2 metadata, pointing to texture export location (relative to OBJ).
- Added `textures.mtlName` property to M2 metadata, linking to an entry in the MTL file.
- Added `textures` property array to WMO metadata, providing expanded texture mappings.
- Added 'Load Unknown Files' option to toggle loading of unknown files from DB2 tables.
- Added 'Load Model Skins' option to toggle loading of M2 skins for creatures and items.
- Unknown sound files are now listed with the `.unk_sound` extension rather than `.ogg`.
- Unknown sound files are now automatically type-detected on export and given the correct extension.

0.1.34 (24-08-2021)
- Added height textures to ADT alpha map exports, mapped in the metadata layer entries.
- Added effectID (GroundEffectTexture#ID) property to ADT alpha map layer metadata.
- Added advanced foliage meta data exporting (disabled by default).

0.1.33 (13-08-2021)
- Added support for unknown sound files, now listed as "unknown_xxx.ogg".
- Fixed issue that prevented unknown model/textures from appearing in the listfiles.

0.1.32 (28-06-2021)
- Added export/import support for additional UV layers in WMO objects.
- Added export support for additional vertex colour layers in WMO objects.
- Added BLP texture exports for raw WMO files.

0.1.31 (04-06-2021)
- Updated Blender add-on to support Blender version 2.93.
- Improved group names in WMO meta data exporting.
- Added option for POSIX-style path formatting in exported files.
- Added option for exporting linked .skel/.bone files with raw M2 exports.
- Added skeletonFileID/boneFileIDs fields to exported M2 metadata.
- Added export support for secondary/tertiary textures on WMO models.
- Fixed issue that prevented certain map tiles from preview/exporting.

0.1.30 (01-05-2021)
- Added 'Export Textures' option to sidebar to allow models to be exported without textures.
- Added fileDataID, fileName and internalName fields to exported M2 meta data.
- Added option to export raw WMO group files (when exporting raw WMO models).
- Added support for MWDS, allowing ADT-defined multi-group support on WMO models.
- Added a wireframe rendering mode to the 3D model preview for both M2 and WMO.
- Added model texture controls to the map exporter interface.
- Added product support for Classic TBC / PTR builds.
- Added portal information to exported WMO meta data.
- Added import controls to the Blender importer add-on.
- Replaced the 'Copy File Directories' setting with a 'Copy Mode' control, with a FileDataID option.
- Changed the default alpha mode to CHANNEL_PACKED in the Blender add-on.
- Fixed issue that caused incorrect nesting when imported with the Blender add-on.
- Fixed issue that caused ADT tiles with Alpha Maps to reference missing baked texture.
- Fixed issue that caused a crash when selecting an encrypted model with an unknown TACT key.
- Fixed issue that caused 'invalid installation' error message from not dismissing after retry.
- Fixed issue that caused missing alpha channels on ADT exports for some users.
- Fixed issue that caused invalid collision OBJ files to be exported.
- Fixed issue that caused WMO doodad sets to be incorrectly exported.

0.1.29 (29-03-2021)
- Added new 'Items' tab, allowing model/texture look-up of specific game items.
- Added ability to select multiple files for import with the Blender add-on.
- Added ability to toggle individual colour channels in the texture browser.
- Added option in Blender add-on to create vertex groups for submeshes.
- Added option in Blender add-on to bypass anti-duplication check for ADT imports.
- Added render flags and blending mode data to M2 meta data exports.
- Added texture types to M2 meta data exports.
- Fixed issue that prevented tiles with missing textures (such as Pandaria_20_20) from exporting.
- Fixed issue that caused exports to 'cancel' after closing the 'export successful' toast.
- Fixed issue that caused default doodad sets in WMOs to not export for ADT tiles.
- Fixed issue that caused OBJ models to export with unused/loose vertices.
- Fixed issue that caused skins to disappear when switching between item models.
- The 'successfully exported' toast will now remain visible until dismissed.

0.1.28 (12-03-2021)
- Added skin selection/export support for creatures/items.
- Added double-sided rendering to M2/WMO 3D previews.
- Added option to display/search file data IDs in listfiles.
- Improved skin naming to fit on screen.
- Improved default selected geosets for models.

0.1.27 (27-02-2021)
- Added option to export UV2 data for M2 models as non-standard OBJ property (disabled by default).
- Added texture information (name, dimensions, encoding) to the texture preview window.
- Added option to export meta data for BLP files (disabled by default).
- Added option to export meta data for WMO files (disabled by default).
- Added 'Use Alpha' option to the Blender add-on. If unchecked, alpha channel is disabled and unlinked in the shader.
- Added vertex colouring data into WMO meta data files.
- Renamed import menu option in Blender add-on from 'WoW OBJ (.obj) (experimental)' to 'WoW M2/WMO/ADT (.obj)'.
- Layer meta data for ADT alpha maps is now exported in JSON format.
- Textures for ADT alpha maps are now exported to their own relative path if 'Enabled Shared Textures' is enabled.
- Textures for ADT alpha maps now have resolved names from the listfile, rather than fileDataIDs.
- Fixed issue in Blender add-on that caused doodads to import slightly offset.
- Fixed issue that could cause alpha channel to be linked incorrectly in imported material shaders.
- Fixed issue that preventing pasting into a listfile search under some circumstances.

0.1.26 (09-02-2021)
- Added a 'Paste Selection' feature for selecting from clipboard input.
- Added a selection counter underneath listfiles.
- Fixed an issue with broken selection information appearing under the skin menu.

0.1.25 (27-01-2021)
- Added legacy fallback support for MDX/MDL files in old WMOs.
- Added a file count indicator under listfiles.
- Fix an issue with spaces being included in MTL material names.

0.1.24 (17-12-2020)
- Fixed missing escape slashes in regex guide tooltip.
- Fixed an issue that prevented exporting Classic WMOs with missing materials.
- Added a 3D grid to the model viewer (can be toggled on the sidebar).
- Added the 'Split Large Terrain Maps' options to settings.
- Added the 'Split Alpha Maps option to settings.
- Removed the 'Map Texture Split Threshold' option from settings.

0.1.23 (28-11-2020)
- Added a warning to the configuration screen for export directories that contain spaces.
- Added indicator for when regular expression searching is enabled with quick-guide tooltip.

0.1.22 (26-11-2020)
- Fixed issue that prevented raw M2/skin exports.
- Fixed an issue with local user-defined listfiles not working without a wildcard.
- Fixed an issue that prevented exporting of cinematics that are locally corrupted.

0.1.21 (25-11-2020)
- Added new 'Text' tab which allows preview/exporting of subtitles, Lua, XML, HTML, config and more.
- Fixed an issue that prevented data tables from parsing on newest WoW builds.

0.1.20 (23-11-2020)
- Added expansion icons to the map exporter list.
- Added ability to cancel exports that are in-progress.
- Added verbose progress information for heavy export tasks (WMOs, ADTs, etc).
- Added 'Strip Whitespace From Copied Paths' option to settings.
- Fixed an issue exporting pre-baked map tiles that lack height textures. (example: https://i.imgur.com/v9nRgjk.jpg)
- Fixed an issue that caused the toast bar to disappear while an export was in progress.
- Fixed an issue with exported WMO objects having .obj prefixed MTL names.
- Fixed an issue that prevented BLTE from parsing data blocks correctly.
- Using the automatic Blender add-on installer now targets all installed versions of Blender on your system.
- Definitions for data tables are now automatically updated (update repository can be configured in settings).

0.1.19 (19-11-2020)
- Added 'Strip Whitespace From Export Paths' option to settings (enabled by default).
- Added the FileDataID field to ModelPlacementInformation CSV files.

0.1.18 (10-11-2020)
- Added 'Texture Alpha' option to model exporter, allowing binary control of texture transparency on models.
- Added geoset labels for new Shadowlands customization.
- Fixed issue that prevented wow.export from failing on corrupt game installations.

0.1.17 (25-10-2020)
- Added ability to export M2 meta data as .json (disabled by default).

0.1.16 (07-09-2020)
- Fixed issue that prevented wow.export from working when launched from the start menu.

0.1.15 (16-08-2020)
- Fixed issue that caused wow.export to crash when registering large amounts of encryption keys.
- Exporting M2 models as RAW will now include related BLP files.
- Fixed inconsistency with whitespace in exported file paths (it is now always stripped).

0.1.14 (08-08-2020)
- The map viewer now supports selecting all tiles at once (Control + A).
- Added 'Include Holes' option, allowing map tiles to be exported without holes.

0.1.13 (30-07-2020)
- Added information tooltips to export control checkboxes.
- Added a 'View Log' button to the top-right navigation for quick access of the application log.
- Fixed issue that prevented mouse wheel navigation on listboxes from being accurate.

0.1.12 (23-07-2020)
- Fixed issue that prevented Blender add-on from working on non-English Blender clients.
- Fixed issue that caused exported PNG files to be premultipled (black splotches).
- Added option to export game objects with map tiles (WIP, slightly broken).

0.1.11 (21-07-2020)
- Added 'Export .skin files' option for raw M2 exporting.
- Fixed issue that prevented some Classic WMOs from exporting correctly due to filename whitespace.
- Exported models now have proper material names instead of fileDataIDs.
- MTL material names are now prefixed with a non-numeric value for compatibility with Maya.

0.1.10 (19-07-2020)
- Fixed issue that prevented doodad sets from exporting/previewing under certain circumstances.
- 3D model panning via W, A, S, D, Q, E keys implemented.
- Allow users to manually configure the map texture split threshold in configuration.
- Added 'Use Absolute Model Placement Paths' option.

0.1.9 (13-01-2020)
- 'Enable Shared Textures' now exports textures to their full path, rather than a unified directory.
- Added a 'Use Absolute MTL Paths' option in settings for Cinema 4D users.
- Added a 'Copy File Directories' setting which makes CTRL + C only copy file directories.
- Fixed issue that prevented exported WMOs with empty groups.
- Fixed issue that prevented some files from being available in remote mode.
- Fixed issue in Blender plugin that slowed down imports significantly.
- Fixed issue in Blender plugin where it would crash on models without materials.
- Fixed issue that prevented duplicate WMOs with different doodad sets from exporting on the same ADT tile.
- Fixed issue where there would be extremely visible lines in terrain textures.
- Fixed issue with ADTs failing to export due to bad/missing doodads and/or WMOs.
- The 'Open Export Directory' link after exporting has been replaced with 'View in Explorer' which opens the directory of the last exported item.

0.1.8 (11-01-2020)
- NPC variant textures can now be selected/exported for creature models.
- Game clients are now checked for unknown models/textures (listed as 'unknown_xxx').
- Foliage doodads can now be exported along with map tiles in the map exporter.
- Global map WMOs can now be exported for maps that contain them (such as Stormwind Stockade).
- Regular expressions can now be used for filtering (disabled by default, turn on in settings).
- Maps that contain the same WMO with differing doodad sets will no longer conflict.
- Exported models will now use a shared texture directory, dramatically reducing disk space used (can be disabled in settings).
- WMO doodads are now exported to their own relative directory, reducing overall disk space used.
- ADT doodads/WMOs are now exported to their own relative directory, reducing overall disk space used.
- Added settings option to disable file overwriting. Improves export speed but may cause issues between game versions.
- Added 'Auto Camera' checkbox under model control to disable automatic camera repositioning.
- Added 'Changelog' button to the top-right navigation, which displays this changelog.
- Fixed issue with faces/normals being incorrect on exported ADT meshes.
- Fixed issue that caused WMO exports to error if you switched to another model during export.
- Fixed texture files for exported WMOs incorrectly having alpha channels (transparency).
- Fixed issue that prevented certain models (and thus some map tiles) from exporting.

0.1.7 (04-01-2020)
- Users will now be prompted when a new version of the Blender add-on is available.
- Automatic installation of the Blender add-on now supports alpha/beta versions of Blender.
- Listfile source can now be configured to point to local listfiles.
- Added fallback to cached listfile if recent listfile fails to download.
- Fixed an issue that prevented recent local installations from appearing on the source selection screen.
- Fixed holes in exported terrain being slightly offset.
- Fixed terrain material name conflicts in Blender by using a unique name per tile.

0.1.6 (03-01-2020)
- Fixed crash when exporting modern ADTs.
- Fixed incorrect ADT WMO Blender import rotations.
- Reduce download/update size by compressing loading animation.

0.1.5 (03-01-2020)
- Fixed incorrect WMO-only Blender import doodad rotations.

0.1.4 (03-01-2020)
- Fixed issue that prevented encryption keys from properly updating.
- Fixed issue that caused map exporter to freeze on certain clients.

0.1.3 (02-01-2020)
- Initial public beta.
