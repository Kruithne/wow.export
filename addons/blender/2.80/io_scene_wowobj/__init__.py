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
    'version': (0, 3, 9),
    'blender': (2, 92, 0),
    'location': 'File > Import-Export > WoW M2/WMO/ADT (.obj)',
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
import os

from bpy_extras.io_utils import (ImportHelper, orientation_helper)

@orientation_helper(axis_forward='-Z', axis_up='Y')

class ImportWoWOBJ(bpy.types.Operator, ImportHelper):
    '''Load a Wavefront OBJ File with additional ADT metadata'''
    bl_idname = 'import_scene.wowobj'
    bl_label = 'Import WoW OBJ'
    bl_options = {'PRESET', 'UNDO'}

    filename_ext = '.obj'
    filter_glob = bpy.props.StringProperty(default='*.obj', options={'HIDDEN'})
    files = bpy.props.CollectionProperty(name = 'Files', type= bpy.types.OperatorFileListElement)
    directory = bpy.props.StringProperty(subtype = 'DIR_PATH')

    useAlpha = bpy.props.BoolProperty(name = 'Use Alpha', description = 'Link alpha channel for materials', default = 1)

    def execute(self, context):
        from . import import_wowobj
        for importFile in self.files:
            import_wowobj.importWoWOBJAddon(os.path.join(self.directory, importFile.name), self.useAlpha)

        return {'FINISHED'}

    def draw(self, context):
        layout = self.layout

        row = layout.row(align=True)
        box = layout.box()

        box.prop(self, 'useAlpha')

def menu_func_import(self, context):
    self.layout.operator(ImportWoWOBJ.bl_idname, text='WoW M2/WMO/ADT (.obj)')

def register():
    from bpy.utils import register_class
    register_class(ImportWoWOBJ)
    bpy.types.TOPBAR_MT_file_import.append(menu_func_import)


def unregister():
    from bpy.utils import unregister_class
    unregister_class(ImportWoWOBJ)
    bpy.types.TOPBAR_MT_file_import.remove(menu_func_import)

if __name__ == '__main__':
    register()