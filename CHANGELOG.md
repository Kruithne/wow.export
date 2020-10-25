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
- Fixed issue that prevented mouse wheel navitation on listboxes from being accurate.

0.1.12 (23-07-2020)
- Fixed issue that prevented Blender add-on from working on non-English Blender clients.
- Fixed issue that caused exported PNG files to be premultiplicated (black splotches).
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