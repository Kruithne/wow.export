# ##### BEGIN GPL LICENSE BLOCK #####
#
#  This program is free software; you can redistribute it and/or
#  modify it under the terms of the GNU General Public License
#  as published by the Free Software Foundation; either version 2
#  of the License, or (at your option) any later version.
#
#  This program is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
#
#  You should have received a copy of the GNU General Public License
#  along with this program; if not, write to the Free Software Foundation,
#  Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
#
# ##### END GPL LICENSE BLOCK #####

# <pep8-80 compliant>

bl_info = {
    'name': 'Import WoW OBJ files with doodads',
    'author': 'Marlamin, Kruithne',
    'version': (0, 3, 16),
    'blender': (5, 0, 0),
    'location': 'File > Import-Export > Import WoW Object (.obj)',
    'description': 'Import OBJ files exported by wow.export with WMOs and doodads',
    'warning': '',
    'wiki_url': '',
    'tracker_url': '',
    'category': 'Import-Export'}

if 'bpy' in locals():
    import importlib
    if 'import_wowobj' in locals():
        importlib.reload(import_wowobj)

import bpy
import bpy.utils.previews
import os
import sys

from bpy_extras.io_utils import (ImportHelper, orientation_helper)

preview_collections = {}


def get_last_export_path():
    """Get the platform-specific path to the last_export file (nw.js data path)."""
    if sys.platform == 'win32':
        base = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
        return os.path.join(base, 'wow.export', 'User Data', 'Default', 'last_export')
    elif sys.platform == 'darwin':
        return os.path.expanduser('~/Library/Application Support/wow.export/User Data/Default/last_export')
    else:
        return os.path.expanduser('~/.config/wow.export/User Data/Default/last_export')

@orientation_helper(axis_forward='-Z', axis_up='Y')

class Settings:
    useAlpha = True
    createVertexGroups = False
    allowDuplicates = False
    importWMO = True
    importWMOSets = True
    importM2 = True
    importGOBJ = True
    importTextures = True
    useTerrainBlending = True
    createEmissiveMaterials = True
    createDoodadSetCollections = False
    importLiquid = True
    importUVAnimations = True

    def __init__(self, useAlpha = True, createVertexGroups = False, allowDuplicates = False, importWMO = True, importWMOSets = True, importM2 = True, importGOBJ = True, importTextures = True, useTerrainBlending = True, createEmissiveMaterials = True, createDoodadSetCollections = False, importLiquid = True, importUVAnimations = True):
        self.useAlpha = useAlpha
        self.createVertexGroups = createVertexGroups
        self.allowDuplicates = allowDuplicates
        self.importWMO = importWMO
        self.importWMOSets = importWMOSets
        self.importM2 = importM2
        self.importGOBJ = importGOBJ
        self.importTextures = importTextures
        self.useTerrainBlending = useTerrainBlending
        self.createEmissiveMaterials = createEmissiveMaterials
        self.createDoodadSetCollections = createDoodadSetCollections
        self.importLiquid = importLiquid
        self.importUVAnimations = importUVAnimations

class ImportWoWOBJ(bpy.types.Operator, ImportHelper):
    '''Load a Wavefront OBJ File with additional ADT metadata'''
    bl_idname = 'import_scene.wowobj'
    bl_label = 'Import WoW OBJ'
    bl_options = {'PRESET', 'UNDO'}

    filename_ext = '.obj'
    filter_glob: bpy.props.StringProperty(default='*.obj', options={'HIDDEN'})
    files: bpy.props.CollectionProperty(name = 'Files', type= bpy.types.OperatorFileListElement)
    directory: bpy.props.StringProperty(subtype = 'DIR_PATH')

    importWMO: bpy.props.BoolProperty(name = 'Import WMO', description = 'If exported, WMOs will be imported', default = 1)
    importWMOSets: bpy.props.BoolProperty(name = 'Import WMO Sets', description = 'If exported, WMO sets will be imported', default = 1)
    importM2: bpy.props.BoolProperty(name = 'Import M2', description = 'If exported, M2s will be imported', default = 1)
    importGOBJ: bpy.props.BoolProperty(name = 'Import GOBJ', description = 'If exported, GOBJs will be imported', default = 1)
    importTextures: bpy.props.BoolProperty(name = 'Import Textures', description = 'If exported, textures will be imported', default = 1)
    useAlpha: bpy.props.BoolProperty(name = 'Use Alpha', description = 'Link alpha channel for materials', default = 1)
    createVertexGroups: bpy.props.BoolProperty(name = 'Create Vertex Groups', description = 'Create vertex groups for submeshes', default = 0)
    allowDuplicates: bpy.props.BoolProperty(name = 'Allow Duplicates (ADT)', description = 'Bypass the duplicate M2/WMO protection for ADT tiles', default = 0)
    useTerrainBlending: bpy.props.BoolProperty(name = 'Use terrain blending', description = 'Blend terrain textures using exported alpha maps', default = 1)
    createEmissiveMaterials: bpy.props.BoolProperty(name = 'Create emissive materials', description = 'When applicable based on the material\'s blending mode. Might be less compatible when exporting to use in other software', default = 1)
    createDoodadSetCollections: bpy.props.BoolProperty(name = 'Create Doodad Set Collections', description = 'If enabled, will create a collection of each doodad set (if available), and move the imported objects into them. Useful for single model imports with many sets.', default = 0)
    importLiquid: bpy.props.BoolProperty(name = 'Import Liquid', description = 'If exported, liquid chunks will be imported as plane geometry', default = 1)
    importUVAnimations: bpy.props.BoolProperty(name = 'Import UV Animations', description = 'If available in M2 models, UV texture animations will be imported and set up automatically', default = 1)

    def execute(self, context):
        settings = Settings(
            useAlpha = self.useAlpha,
            createVertexGroups = self.createVertexGroups,
            allowDuplicates = self.allowDuplicates,
            importWMO = self.importWMO,
            importWMOSets = self.importWMOSets,
            importM2 = self.importM2,
            importGOBJ = self.importGOBJ,
            importTextures = self.importTextures,
            useTerrainBlending = self.useTerrainBlending,
            createEmissiveMaterials = self.createEmissiveMaterials,
            createDoodadSetCollections = self.createDoodadSetCollections,
            importLiquid = self.importLiquid,
            importUVAnimations = self.importUVAnimations
        )
        settings._import_cache_cleared = False

        from . import import_wowobj
        if self.files:
            for importFile in self.files:
                import_wowobj.importWoWOBJAddon(os.path.join(self.directory, importFile.name), settings)
        elif self.filepath:
            # Backwards compatibility for old API for custom tooling.
            import_wowobj.importWoWOBJAddon(self.filepath, settings)

        return {'FINISHED'}

    def draw(self, context):
        layout = self.layout

        row = layout.row(align=True)
        box = layout.box()

        box.prop(self, 'importWMO')
        box.prop(self, 'importWMOSets')
        box.prop(self, 'importM2')
        box.prop(self, 'importGOBJ')
        box.prop(self, 'importTextures')
        box.prop(self, 'importUVAnimations')
        box.prop(self, 'useAlpha')
        box.prop(self, 'createVertexGroups')
        box.prop(self, 'allowDuplicates')
        box.prop(self, 'useTerrainBlending')
        box.prop(self, 'createEmissiveMaterials')
        box.prop(self, 'createDoodadSetCollections')
        box.prop(self, 'importLiquid')

def menu_func_import(self, context):
    self.layout.operator(ImportWoWOBJ.bl_idname, text='WoW Object (.obj)')


class WOWEXPORT_OT_import_dialog(bpy.types.Operator):
    """Open the WoW Object import dialog"""
    bl_idname = 'wowexport.import_dialog'
    bl_label = 'Import WoW OBJ'
    bl_options = {'REGISTER'}

    def execute(self, context):
        bpy.ops.import_scene.wowobj('INVOKE_DEFAULT')
        return {'FINISHED'}


class WOWEXPORT_OT_import_last_export(bpy.types.Operator):
    """Import models from the last wow.export session"""
    bl_idname = 'wowexport.import_last_export'
    bl_label = 'Import Last Export'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        export_file = get_last_export_path()

        if not os.path.exists(export_file):
            self.report({'ERROR'}, f'Export file not found: {export_file}')
            return {'CANCELLED'}

        # prefixes mapped to import handlers
        obj_prefixes = ('M2_OBJ:', 'M3_OBJ:', 'WMO_OBJ:', 'ADT_OBJ:')
        gltf_prefixes = ('M2_GLTF:', 'M2_GLB:', 'M3_GLTF:', 'M3_GLB:', 'WMO_GLTF:', 'WMO_GLB:')
        stl_prefixes = ('M2_STL:', 'M3_STL:', 'WMO_STL:')

        imported_count = 0

        try:
            with open(export_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue

                    matched = False

                    # obj imports using our custom importer
                    for prefix in obj_prefixes:
                        if line.startswith(prefix):
                            file_path = line[len(prefix):]
                            if os.path.exists(file_path):
                                bpy.ops.import_scene.wowobj(filepath=file_path)
                                imported_count += 1
                            else:
                                self.report({'WARNING'}, f'File not found: {file_path}')
                            matched = True
                            break

                    if matched:
                        continue

                    # gltf imports using blender's importer
                    for prefix in gltf_prefixes:
                        if line.startswith(prefix):
                            file_path = line[len(prefix):]
                            if os.path.exists(file_path):
                                bpy.ops.import_scene.gltf(filepath=file_path)
                                imported_count += 1
                            else:
                                self.report({'WARNING'}, f'File not found: {file_path}')
                            matched = True
                            break

                    if matched:
                        continue

                    # stl imports using blender's importer
                    for prefix in stl_prefixes:
                        if line.startswith(prefix):
                            file_path = line[len(prefix):]
                            if os.path.exists(file_path):
                                bpy.ops.import_mesh.stl(filepath=file_path)
                                imported_count += 1
                            else:
                                self.report({'WARNING'}, f'File not found: {file_path}')
                            break

            if imported_count > 0:
                self.report({'INFO'}, f'Imported {imported_count} object(s)')
            else:
                self.report({'WARNING'}, 'No importable objects found in last export')

            return {'FINISHED'}

        except Exception as e:
            self.report({'ERROR'}, f'Error importing: {str(e)}')
            return {'CANCELLED'}


class WOWEXPORT_PT_sidebar_panel(bpy.types.Panel):
    """wow.export tools panel in the 3D viewport sidebar"""
    bl_label = 'wow.export'
    bl_idname = 'WOWEXPORT_PT_sidebar_panel'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'wow.export'

    def draw(self, context):
        layout = self.layout

        pcoll = preview_collections.get('main')
        if pcoll and 'logo' in pcoll:
            row = layout.row()
            row.alignment = 'CENTER'
            row.template_icon(icon_value=pcoll['logo'].icon_id, scale=2.5)
            layout.separator(factor=0.75)

        layout.operator('wowexport.import_dialog')
        layout.operator('wowexport.import_last_export')


classes = (
    ImportWoWOBJ,
    WOWEXPORT_OT_import_dialog,
    WOWEXPORT_OT_import_last_export,
    WOWEXPORT_PT_sidebar_panel,
)


def register():
    from bpy.utils import register_class
    for cls in classes:
        register_class(cls)
    bpy.types.TOPBAR_MT_file_import.append(menu_func_import)

    pcoll = bpy.utils.previews.new()
    logo_path = os.path.join(os.path.dirname(__file__), 'logo.png')
    if os.path.exists(logo_path):
        pcoll.load('logo', logo_path, 'IMAGE')
    preview_collections['main'] = pcoll


def unregister():
    from bpy.utils import unregister_class
    bpy.types.TOPBAR_MT_file_import.remove(menu_func_import)
    for cls in reversed(classes):
        unregister_class(cls)

    for pcoll in preview_collections.values():
        bpy.utils.previews.remove(pcoll)
    preview_collections.clear()


if __name__ == '__main__':
    register()
