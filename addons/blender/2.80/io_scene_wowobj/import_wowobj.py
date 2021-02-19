import bpy
import bmesh
import os
import csv

from math import radians
from mathutils import Quaternion
from datetime import datetime

def importWoWOBJAddon(objectFile):
    importWoWOBJ(objectFile)
    return {'FINISHED'}

def getFirstNodeOfType(nodes, nodeType):
    for node in nodes:
        if node.type == nodeType:
            return node

    return None

def importWoWOBJ(objectFile, givenParent = None):
    baseDir, fileName = os.path.split(objectFile)

    print('Parsing OBJ: ' + fileName)
    ### OBJ wide
    material_libs = set()
    mtlfile = ""
    verts = []
    normals = []
    uv = []
    meshes = []

    ### Per group
    class OBJMesh:
        def __init__(self):
            self.usemtl = ""
            self.name = ""
            self.faces = []

    curMesh = OBJMesh()
    meshIndex = -1
    with open(objectFile, 'rb') as f:
        for line in f:
            line_split = line.split()
            if not line_split:
                continue
            line_start = line_split[0]
            if line_start == b'mtllib':
                mtlfile = line_split[1]
            elif line_start == b'v':
                verts.append([float(v) for v in line_split[1:]])
            elif line_start == b'vn':
                normals.append([float(v) for v in line_split[1:]])
            elif line_start == b'vt':
                uv.append([float(v) for v in line_split[1:]])
            elif line_start == b'f':
                line_split = line_split[1:]
                meshes[meshIndex].faces.append((
                    int(line_split[0].split(b'/')[0]),
                    int(line_split[1].split(b'/')[0]),
                    int(line_split[2].split(b'/')[0])
                ))
            elif line_start == b'g':
                meshIndex += 1
                meshes.append(OBJMesh())
                meshes[meshIndex].name = line_split[1].decode("utf-8")
            elif line_start == b'usemtl':
                meshes[meshIndex].usemtl = line_split[1].decode("utf-8")


    ## Materials file (.mtl)
    materials = dict()
    matname = ""
    matfile = ""
    if mtlfile != "":
	    with open(os.path.join(baseDir, mtlfile.decode("utf-8") ), 'r') as f:
	        for line in f:
	            line_split = line.split()
	            if not line_split:
	                continue
	            line_start = line_split[0]

	            if line_start == 'newmtl':
	                matname = line_split[1]
	            elif line_start == 'map_Kd':
	                matfile = line_split[1]
	                materials[matname] = os.path.join(baseDir, matfile)

    if bpy.ops.object.select_all.poll():
        bpy.ops.object.select_all(action='DESELECT')


    # TODO: Better handling for dupes?
    objname = os.path.basename(objectFile)

    if objname in bpy.data.objects:
        objindex = 1
        newname = objname
        while(newname in bpy.data.objects):
            newname = objname + '.' + str(objindex).rjust(3, '0')
            objindex += 1

    newmesh = bpy.data.meshes.new(objname)
    obj = bpy.data.objects.new(objname, newmesh)

    ## Textures
    # TODO: Must be a better way to do this!
    materialmapping = dict()

    # Create a new material instance for each material entry.
    for matname, textureLocation in materials.items():
        if (matname not in bpy.data.materials):
            mat = bpy.data.materials.new(name=matname)
            mat.use_nodes = True
            mat.blend_method = 'CLIP'

            node_tree = mat.node_tree
            nodes = node_tree.nodes

            # Note on socket reference localization:
            # Unlike nodes, sockets can be referenced in English regardless of localization.
            # This will break if the user sets the socket names to any non-default value.

            # Create new Principled BSDF and Image Texture nodes.
            principled = None
            outNode = None

            for node in nodes:
                if not principled and node.type == 'BSDF_PRINCIPLED':
                    principled = node

                if not outNode and node.type == 'OUTPUT_MATERIAL':
                    outNode = node

                if principled and outNode:
                    break

            # If there is no Material Output node, create one.
            if not outNode:
                outNode = nodes.new('ShaderNodeOutputMaterial')

            # If there is no default Principled BSDF node, create one and link it to material output.
            if not principled:
                principled = nodes.new('ShaderNodeBsdfPrincipled')
                node_tree.links.new(principled.outputs['BSDF'], outNode.inputs['Surface'])

            # Create a new Image Texture node.
            image = nodes.new('ShaderNodeTexImage')

            # Load the image file itself if necessary.
            imageName = os.path.basename(textureLocation)
            if not imageName in bpy.data.images:
                bpy.data.images.load(textureLocation)

            image.image = bpy.data.images[imageName]

            node_tree.links.new(image.outputs['Color'], principled.inputs['Base Color'])
            node_tree.links.new(image.outputs['Alpha'], principled.inputs['Alpha'])

            # Set the specular value to 0 by default.
            principled.inputs['Specular'].default_value = 0

        obj.data.materials.append(bpy.data.materials[matname])

        # TODO: Must be a better way to do this!
        materialmapping[matname] = len(obj.data.materials) - 1

    ## Meshes
    bm = bmesh.new()

    i = 0
    for v in verts:
        vert = bm.verts.new(v)
        vert.normal = normals[i]
        i = i + 1

    bm.verts.ensure_lookup_table()
    bm.verts.index_update()

    for mesh in meshes:
        exampleFaceSet = False
        for face in mesh.faces:
            try:
                ## TODO: Must be a better way to do this, this is already much faster than doing material every face, but still.
                if exampleFaceSet == False:
                    bm.faces.new((
                        bm.verts[face[0] - 1],
                        bm.verts[face[1] - 1],
                        bm.verts[face[2] - 1]
                    ))
                    bm.faces.ensure_lookup_table()
                    if mesh.usemtl:
                        bm.faces[-1].material_index = materialmapping[mesh.usemtl]
                    bm.faces[-1].smooth = True
                    exampleFace = bm.faces[-1]
                    exampleFaceSet = True
                else:
                    ## Use example face if set to speed up material copy!
                    bm.faces.new((
                        bm.verts[face[0] - 1],
                        bm.verts[face[1] - 1],
                        bm.verts[face[2] - 1]
                    ), exampleFace)
            except ValueError:
                ## TODO: Duplicate faces happen for some reason
                pass


    uv_layer = bm.loops.layers.uv.new()
    for face in bm.faces:
        for loop in face.loops:
            loop[uv_layer].uv = uv[loop.vert.index]

    bm.to_mesh(newmesh)
    bm.free()

    ## Rotate object the right way
    obj.rotation_euler = [0, 0, 0]
    obj.rotation_euler.x = radians(90)

    bpy.context.scene.collection.objects.link(obj)
    obj.select_set(True)

    ## WoW coordinate system
    max_size = 51200 / 3
    map_size = max_size * 2
    adt_size = map_size / 64

    ## Import doodads and/or WMOs
    csvPath = objectFile.replace('.obj', '_ModelPlacementInformation.csv')

    if os.path.exists(csvPath):
         with open(csvPath) as csvFile:
            reader = csv.DictReader(csvFile, delimiter=';')
            if 'Type' in reader.fieldnames:
                importType = 'ADT'

                wmoparent = bpy.data.objects.new("WMOs", None)
                wmoparent.parent = obj
                wmoparent.name = "WMOs"
                wmoparent.rotation_euler = [0, 0, 0]
                wmoparent.rotation_euler.x = radians(-90)
                bpy.context.scene.collection.objects.link(wmoparent)

                doodadparent = bpy.data.objects.new("Doodads", None)
                doodadparent.parent = obj
                doodadparent.name = "Doodads"
                doodadparent.rotation_euler = [0, 0, 0]
                doodadparent.rotation_euler.x = radians(-90)
                bpy.context.scene.collection.objects.link(doodadparent)

                gobjparent = bpy.data.objects.new("GameObjects", None)
                gobjparent.parent = obj
                gobjparent.name = "GameObjects"
                gobjparent.rotation_euler = [0, 0, 0]
                gobjparent.rotation_euler.x = radians(-90)
                bpy.context.scene.collection.objects.link(gobjparent)
            else:
                importType = 'WMO'
                if not givenParent:
                    print('WMO import without given parent, creating..')
                    givenParent = bpy.data.objects.new("WMO parent", None)
                    givenParent.parent = obj
                    givenParent.name = "Doodads"
                    givenParent.rotation_euler = [0, 0, 0]
                    givenParent.rotation_euler.x = radians(-90)
                    bpy.context.scene.collection.objects.link(givenParent)
            for row in reader:
                if importType == 'ADT':
                    if 'importedModelIDs' in bpy.context.scene:
                        tempModelIDList = bpy.context.scene['importedModelIDs']
                    else:
                        tempModelIDList = []
                    if row['ModelId'] in tempModelIDList:
                        print('Skipping already imported model ' + row['ModelId'])
                        continue
                    else:
                        tempModelIDList.append(row['ModelId'])

                    # ADT CSV
                    if row['Type'] == 'wmo':
                        print('ADT WMO import: ' + row['ModelFile'])

                        # Make WMO parent that holds WMO and doodads
                        parent = bpy.data.objects.new(os.path.basename(row['ModelFile']) + " parent", None)
                        parent.parent = wmoparent
                        parent.location = (17066 - float(row['PositionX']), (17066 - float(row['PositionZ'])) * -1, float(row['PositionY']))
                        parent.rotation_euler = [0, 0, 0]
                        parent.rotation_euler.x += radians(float(row['RotationZ']))
                        parent.rotation_euler.y += radians(float(row['RotationX']))
                        parent.rotation_euler.z = radians((90 + float(row['RotationY'])))
                        if row['ScaleFactor']:
                            parent.scale = (float(row['ScaleFactor']), float(row['ScaleFactor']), float(row['ScaleFactor']))
                        bpy.context.scene.collection.objects.link(parent)

                        ## Only import OBJ if model is not yet in scene, otherwise copy existing
                        if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                            importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), parent)
                        else:
                            ## Don't copy WMOs with doodads!
                            if os.path.exists(os.path.join(baseDir, row['ModelFile'].replace('.obj', '_ModelPlacementInformation.csv'))):
                                importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), parent)
                            else:
                                originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                                importedFile = originalObject.copy()
                                importedFile.data = originalObject.data.copy()
                                bpy.context.scene.collection.objects.link(importedFile)

                        importedFile.parent = parent
                    elif row['Type'] == 'm2':
                        print('ADT M2 import: ' + row['ModelFile'])

                        ## Only import OBJ if model is not yet in scene, otherwise copy existing
                        if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                            importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']))
                        else:
                            originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                            importedFile = originalObject.copy()
                            importedFile.rotation_euler = [0, 0, 0]
                            importedFile.rotation_euler.x = radians(90)
                            bpy.context.scene.collection.objects.link(importedFile)

                        importedFile.parent = doodadparent

                        importedFile.location.x = (17066 - float(row['PositionX']))
                        importedFile.location.y = (17066 - float(row['PositionZ'])) * -1
                        importedFile.location.z = float(row['PositionY'])
                        importedFile.rotation_euler.x += radians(float(row['RotationZ']))
                        importedFile.rotation_euler.y += radians(float(row['RotationX']))
                        importedFile.rotation_euler.z = radians(90 + float(row['RotationY']))
                        if row['ScaleFactor']:
                            importedFile.scale = (float(row['ScaleFactor']), float(row['ScaleFactor']), float(row['ScaleFactor']))
                    elif row['Type'] == 'gobj':
                        if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                            importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']))
                        else:
                            originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                            importedFile = originalObject.copy()
                            importedFile.rotation_euler = [0, 0, 0]
                            importedFile.rotation_euler.x = radians(90)
                            bpy.context.scene.collection.objects.link(importedFile)

                        importedFile.parent = gobjparent
                        importedFile.location = (float(row['PositionY']), -float(row['PositionX']), float(row['PositionZ']))
                        rotQuat = Quaternion((float(row['RotationX']), float(row['RotationY']), -float(row['RotationZ']), float(row['RotationW'])))
                        rotEul = rotQuat.to_euler()
                        importedFile.rotation_euler = rotEul
                        if row['ScaleFactor']:
                            importedFile.scale = (float(row['ScaleFactor']), float(row['ScaleFactor']), float(row['ScaleFactor']))
                    bpy.context.scene['importedModelIDs'] = tempModelIDList
                else:
                    # WMO CSV
                    print('WMO M2 import: ' + row['ModelFile'])
                    if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                        importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']))
                    else:
                        originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                        importedFile = originalObject.copy()
                        bpy.context.scene.collection.objects.link(importedFile)

                    importedFile.location = (float(row['PositionX']), float(row['PositionY']), float(row['PositionZ']))

                    importedFile.rotation_euler = [0, 0, 0]
                    rotQuat = Quaternion((float(row['RotationW']), float(row['RotationX']), float(row['RotationY']), float(row['RotationZ'])))
                    rotEul = rotQuat.to_euler()
                    rotEul.x += radians(90)
                    importedFile.rotation_euler = rotEul
                    importedFile.parent = givenParent or obj
                    if row['ScaleFactor']:
                        importedFile.scale = (float(row['ScaleFactor']), float(row['ScaleFactor']), float(row['ScaleFactor']))

    return obj


#objectFile = "D:\\models\\world\\maps\\azeroth\\azeroth_32_32.obj"
#objectFile = "D:\\models\\world\\maps\\kultiras\\kultiras_32_29.obj"
#objectFile = "D:\\models\\world\\wmo\\kultiras\\human\\8hu_kultiras_seabattlement01.obj"
#importWoWOBJ(objectFile)