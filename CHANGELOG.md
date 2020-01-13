0.1.9 (13-01-2020)
- 'Enable Shared Textures' now exports textures to their full path, rather than a unified directory.
- Added a 'Use Absolute MTL Paths' option in settings for Cinema 4D users.
- Added a 'Copy File Directories' setting which makes CTRL + C only copy file directories.
- Fixed issue that prevented some files from being available in remote mode.
- Fixed issue in Blender plugin that slowed down imports significantly.
- Fixed issue in Blender plugin where it would crash on models without materials.
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