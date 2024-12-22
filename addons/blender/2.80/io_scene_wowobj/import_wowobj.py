import bpy
import bmesh
import os
import csv
import hashlib
import json
from collections import defaultdict

from math import radians
from mathutils import Quaternion

IS_B40 = bpy.app.version >= (4, 0, 0)

SPECULAR_INPUT_NAME = 'Specular IOR Level' if IS_B40 else 'Specular'

def importWoWOBJAddon(objectFile, settings):
    importWoWOBJ(objectFile, None, settings)

def getFirstNodeOfType(nodes, nodeType):
    for node in nodes:
        if node.type == nodeType:
            return node

    return None


def normalizeName(name):
    # Blender doesn't support names longer than 63.
    # Hashing retains uniqueness (to prevent collisions) while fitting in the limit.
    if len(name) > 59:
        return name[:48] + '_' + hashlib.md5(name.encode()).hexdigest()[:10]

    return name


def loadImage(textureLocation):
    imageName, imageExt = os.path.splitext(os.path.basename(textureLocation))
    imageName = normalizeName(imageName)

    if not imageName in bpy.data.images:
        loadedImage = bpy.data.images.load(textureLocation)
        loadedImage.name = imageName

    return bpy.data.images[imageName]

def createStandardMaterial(materialName, textureLocation, blendMode, createEmissive):
    material = bpy.data.materials.new(name=materialName)
    material.use_nodes = True

    if blendMode in {2, 4}:
        material.blend_method = 'BLEND'
    else:
        material.blend_method = 'CLIP'

    node_tree = material.node_tree
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
        outNode.location = (300, 400)

    # If there is no default Principled BSDF node, create one and link it to material output.
    if not principled:
        principled = nodes.new('ShaderNodeBsdfPrincipled')
        principled.location = (0, 400)
        node_tree.links.new(principled.outputs['BSDF'], outNode.inputs['Surface'])

    # Create a new Image Texture node.
    image = nodes.new('ShaderNodeTexImage')

    image.image = loadImage(textureLocation)
    image.image.alpha_mode = 'CHANNEL_PACKED'

    if blendMode == 4 and createEmissive:
        nodes.remove(principled)
        emission = nodes.new('ShaderNodeEmission')
        node_tree.links.new(image.outputs['Color'], emission.inputs['Color'])
        node_tree.links.new(image.outputs['Alpha'], emission.inputs['Strength'])

        transparent = nodes.new('ShaderNodeBsdfTransparent')

        add_shader = nodes.new('ShaderNodeAddShader')
        node_tree.links.new(transparent.outputs['BSDF'], add_shader.inputs[0])
        node_tree.links.new(emission.outputs['Emission'], add_shader.inputs[1])
        node_tree.links.new(add_shader.outputs['Shader'], outNode.inputs['Surface'])
    else:
        node_tree.links.new(image.outputs['Color'], principled.inputs['Base Color'])

        if blendMode != 0:
            node_tree.links.new(image.outputs['Alpha'], principled.inputs['Alpha'])

        # Set the specular value to 0 by default.
        principled.inputs[SPECULAR_INPUT_NAME].default_value = 0

    return material


MIX_NODE_COLOR_SOCKETS = {'in': {}, 'out': {}}

def calculate_color_sockets(mix_node):
    input_index = 0
    for idx, i in enumerate(mix_node.inputs):
        if 'Fac' in i.name and i.type == 'VALUE':
            MIX_NODE_COLOR_SOCKETS['in']['Factor'] = idx
        if i.type == 'RGBA':
            MIX_NODE_COLOR_SOCKETS['in'][('A', 'B')[input_index]] = idx
            input_index += 1

    for idx, i in enumerate(mix_node.outputs):
        if i.type == 'RGBA':
            MIX_NODE_COLOR_SOCKETS['out']['Result'] = idx

def createBlendedTerrain(materialName, textureLocation, layers, baseDir):
    material = bpy.data.materials.new(name=materialName)
    try:
        material.use_nodes = True
        material.blend_method = 'CLIP'

        node_tree = material.node_tree
        nodes = node_tree.nodes

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

        # Set the specular value to 0 by default.
        principled.inputs[SPECULAR_INPUT_NAME].default_value = 0

        texture_coords = nodes.new('ShaderNodeTexCoord')
        texture_coords.location = (-1700, 600)

        alpha_map_frame = nodes.new(type='NodeFrame')
        alpha_map_frame.label = 'Alpha map'

        alpha_map = nodes.new('ShaderNodeTexImage')
        alpha_map.location = (-700, -100)
        alpha_map.width = 140
        alpha_map.image = loadImage(textureLocation)
        alpha_map.image.colorspace_settings.name = 'Non-Color'
        alpha_map.interpolation = 'Cubic'
        alpha_map.extension = 'EXTEND'
        alpha_map.parent = alpha_map_frame

        alpha_map_channels = nodes.new('ShaderNodeSeparateColor')
        alpha_map_channels.location = (-500, -100)
        alpha_map_channels.width = 140
        alpha_map_channels.parent = alpha_map_frame

        node_tree.links.new(alpha_map.outputs['Color'], alpha_map_channels.inputs['Color'])

        base_layer_frame = nodes.new(type='NodeFrame')
        base_layer_frame.label = 'Layer #0'
        
        base_layer = nodes.new('ShaderNodeTexImage')
        base_layer.location = (-1000, 0)
        base_layer.image = loadImage(os.path.join(baseDir, layers[0]['file']))
        base_layer.image.alpha_mode = 'NONE'
        base_layer.hide = True
        base_layer.parent = base_layer_frame

        texture_mapping = nodes.new('ShaderNodeMapping')
        texture_mapping.location = (-1300, 0)
        texture_mapping.inputs[3].default_value[0] = 8 / layers[0]['scale']
        texture_mapping.inputs[3].default_value[1] = 8 / layers[0]['scale']
        texture_mapping.inputs[3].default_value[2] = 8 / layers[0]['scale']
        texture_mapping.parent = base_layer_frame

        node_tree.links.new(texture_coords.outputs['UV'], texture_mapping.inputs['Vector'])
        
        node_tree.links.new(texture_mapping.outputs['Vector'], base_layer.inputs['Vector'])

        # if('heightFile' in layers[0]):
        #     height_map = nodes.new('ShaderNodeTexImage')
        #     height_map.location = (-1000, -50)
        #     height_map.image = loadImage(os.path.join(baseDir, layers[0]['heightFile']))
        #     height_map.image.alpha_mode = 'NONE'
        #     height_map.parent = base_layer_frame

        #     node_tree.links.new(texture_mapping.outputs['Vector'], height_map.inputs['Vector'])

        last_map_node_pos = 0
        last_tex_node_pos = 0
        last_height_tex_node_pos = -50
        last_mix_node_pos = 0
        last_mix_node = None

        for idx, layer in enumerate(layers[1:]):
            try:
                mix_node = nodes.new('ShaderNodeMix')
                mix_node.location = (-300, last_mix_node_pos + 200)
                mix_node.data_type = 'RGBA'
                last_mix_node_pos += 200
            except:
                mix_node = nodes.new('ShaderNodeMixRGB')
                mix_node.location = (-300, last_mix_node_pos + 200)
                last_mix_node_pos += 200

            if not MIX_NODE_COLOR_SOCKETS['in']:
                calculate_color_sockets(mix_node)

            node_tree.links.new(
                alpha_map_channels.outputs[idx],
                mix_node.inputs[MIX_NODE_COLOR_SOCKETS['in']['Factor']])

            if last_mix_node is None:
                node_tree.links.new(
                    base_layer.outputs['Color'],
                    mix_node.inputs[MIX_NODE_COLOR_SOCKETS['in']['A']])
            else:
                node_tree.links.new(
                    last_mix_node.outputs[MIX_NODE_COLOR_SOCKETS['out']['Result']],
                    mix_node.inputs[MIX_NODE_COLOR_SOCKETS['in']['A']])

            layer_frame = nodes.new(type='NodeFrame')
            layer_frame.label = 'Layer #' + str(idx + 1)
            texture_mapping_layer = nodes.new('ShaderNodeMapping')
            texture_mapping_layer.location = (-1300, last_map_node_pos + 420)
            texture_mapping_layer.inputs[3].default_value[0] = 8 / layer['scale']
            texture_mapping_layer.inputs[3].default_value[1] = 8 / layer['scale']
            texture_mapping_layer.inputs[3].default_value[2] = 8 / layer['scale']
            texture_mapping_layer.parent = layer_frame
            last_map_node_pos += 420

            node_tree.links.new(texture_coords.outputs['UV'], texture_mapping_layer.inputs['Vector'])

            layer_texture = nodes.new('ShaderNodeTexImage')
            layer_texture.location = (-1000, last_tex_node_pos + 420)
            layer_texture.image = loadImage(os.path.join(baseDir, layer['file']))
            layer_texture.image.alpha_mode = 'NONE'
            layer_texture.hide = True
            layer_texture.parent = layer_frame
            last_tex_node_pos += 420

            # if('heightFile' in layer):
            #     layer_height_map = nodes.new('ShaderNodeTexImage')
            #     layer_height_map.location = (-1000, last_height_tex_node_pos + 420)
            #     layer_height_map.image = loadImage(os.path.join(baseDir, layer['heightFile']))
            #     layer_height_map.image.alpha_mode = 'NONE'
            #     layer_height_map.parent = layer_frame
            #     last_height_tex_node_pos += 420

            #     node_tree.links.new(texture_mapping_layer.outputs['Vector'], layer_height_map.inputs['Vector'])

            node_tree.links.new(texture_mapping_layer.outputs['Vector'], layer_texture.inputs['Vector'])
            node_tree.links.new(
                layer_texture.outputs['Color'],
                mix_node.inputs[MIX_NODE_COLOR_SOCKETS['in']['B']])

            last_mix_node = mix_node

        if last_mix_node is None:
            node_tree.links.new(base_layer.outputs['Color'], principled.inputs['Base Color'])
        else:
            node_tree.links.new(
                last_mix_node.outputs[MIX_NODE_COLOR_SOCKETS['out']['Result']],
                principled.inputs['Base Color'])

        return material
    except Exception as e:
        print('failed to create terrain material for %s' % materialName)
        print(e)
        bpy.data.materials.remove(material)

            
def importWoWOBJ(objectFile, givenParent = None, settings = None, doodadSets = None):
    baseDir, fileName = os.path.split(objectFile)

    print('Parsing OBJ: ' + fileName)
    ### OBJ wide
    material_libs = set()
    mtlfile = ''
    verts = []
    normals = []
    uvs = []
    meshes = []

    ### Per group
    class OBJMesh:
        def __init__(self):
            self.usemtl = ''
            self.name = ''
            self.verts = set()
            self.faces = []

    json_info = {}
    try:
        with open(os.path.join(baseDir, fileName[:fileName.rfind('.')] + '.json')) as fp:
            json_info = json.load(fp)
            if json_info.get('fileType') == 'm2':
                json_info['skinTexUnits'] = {i['skinSectionIndex']: i for i in json_info['skin']['textureUnits']}
            elif json_info.get('fileType') == 'wmo':
                json_info['mtlTextureIds'] = {i['fileDataID']: i['mtlName'] for i in json_info['textures']}
                json_info['mtlIndexes'] = {
                    json_info['mtlTextureIds'][data['texture1']]: idx
                    for idx, data in enumerate(json_info['materials'])
                    if data['texture1'] in json_info['mtlTextureIds']}
    except:
        pass

    curMesh = OBJMesh()
    matBlendModes = defaultdict(list)
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
            elif line_start.startswith(b'vt'):
                layer_index = 0

                if len(line_start) > 2:
                    line_str = line_start.decode('utf8')
                    layer_index = int(line_str[-1]) - 1

                if len(uvs) <= layer_index:
                    uvs.append([])

                uvs[layer_index].append([float(v) for v in line_split[1:]])
            elif line_start == b'f':
                line_split = line_split[1:]
                fv = [int(v.split(b'/')[0]) for v in line_split]
                meshes[meshIndex].faces.append((fv[0], fv[1], fv[2]))
                meshes[meshIndex].verts.update([i - 1 for i in fv])
            elif line_start == b'g':
                meshIndex += 1
                meshes.append(OBJMesh())
                meshes[meshIndex].name = line_split[1].decode('utf-8')
            elif line_start == b'usemtl':
                materialName = normalizeName(line_split[1].decode('utf-8'))

                if settings.useAlpha:
                    blendingMode = None

                    if json_info.get('fileType') == 'm2':
                        blendingMode = json_info['materials'][json_info['skinTexUnits'][meshIndex]['materialIndex']]['blendingMode']
                    elif json_info.get('fileType') == 'wmo':
                        try:
                            blendingMode = json_info['materials'][json_info['mtlIndexes'][materialName]]['blendMode']
                        except KeyError:
                            print('error getting material blending mode for %s' % materialName)

                    if blendingMode is not None:
                        matBlendModes[materialName].append(blendingMode)
                        # use texture with specific blending mode
                        materialName += '_B' + str(blendingMode)

                meshes[meshIndex].usemtl = materialName

    # Defaults to master collection if no collection exists.
    collection = bpy.context.view_layer.active_layer_collection.collection.objects

    ## Materials file (.mtl)
    materials = dict()
    matname = ''
    matfile = ''
    if mtlfile != '':
        with open(os.path.join(baseDir, mtlfile.decode('utf-8') ), 'r') as f:
            for line in f:
                line_split = line.split()
                if not line_split:
                    continue
                line_start = line_split[0]

                if line_start == 'newmtl':
                    matname = normalizeName(line_split[1])
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

    # Create a new material instance for each material entry.
    if settings.importTextures:
        usedMaterials = {mesh.usemtl for mesh in meshes}

        for materialName, textureLocation in materials.items():
            material = bpy.data.materials.get(materialName)
            materialB = {}
            for bm in matBlendModes[materialName]:
                materialBName = materialName + '_B' + str(bm)
                materialB[bm] = (materialBName, bpy.data.materials.get(materialBName))

            if material is None:
                if settings.useTerrainBlending:
                    material_json = {}
                    try:
                        with open(os.path.join(baseDir, materialName + '.json')) as fp:
                            material_json = json.load(fp)
                    except:
                        pass

                    if 'layers' in material_json:
                        material = createBlendedTerrain(materialName, textureLocation, material_json['layers'], baseDir)
                
                if material is None and materialName in usedMaterials:
                    material = createStandardMaterial(materialName, textureLocation, -1, False)

            if settings.useAlpha:
                for bm, (materialBName, materialBMat) in materialB.items():
                    # create materials with different blending modes
                    if materialBName in usedMaterials and materialBMat is None:
                        materialB[bm] = (materialBName, createStandardMaterial(materialBName, textureLocation, bm, settings.createEmissiveMaterials))

            if materialName in usedMaterials:
                obj.data.materials.append(material)

            for (materialBName, materialBMat) in materialB.values():
                if materialBName in usedMaterials:
                    obj.data.materials.append(materialBMat)

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
                        bm.faces[-1].material_index = obj.data.materials.find(mesh.usemtl)

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

    for layer_index, layer in enumerate(uvs):
        uv_name = layer_index > 0 and ('UV' + str(layer_index + 1) + 'Map') or 'UVMap'
        uv_layer = bm.loops.layers.uv.new(uv_name)

        for face in bm.faces:
            for loop in face.loops:
                loop[uv_layer].uv = layer[loop.vert.index]

    bm.to_mesh(newmesh)
    bm.free()

    # needed to have a mesh before we can create vertex groups, so do that now
    if settings.createVertexGroups:
        for mesh in sorted(meshes, key=lambda m: m.name.lower()):
            vg = obj.vertex_groups.new(name=f"{mesh.name}")
            vg.add(list(mesh.verts), 1.0, "REPLACE")

    ## Rotate object the right way
    obj.rotation_euler = [0, 0, 0]
    obj.rotation_euler.x = radians(90)

    collection.link(obj)
    obj.select_set(True)

    ## WoW coordinate system
    max_size = 51200 / 3
    map_size = max_size * 2
    adt_size = map_size / 64

    ## Import doodads and/or WMOs
    csvPath = objectFile.replace('.obj', '_ModelPlacementInformation.csv')
    use_csv = settings.importWMO or settings.importM2 or settings.importWMOSets or settings.importGOBJ

    if use_csv and os.path.exists(csvPath):
        with open(csvPath) as csvFile:
            reader = csv.DictReader(csvFile, delimiter=';')
            if 'Type' in reader.fieldnames:
                importType = 'ADT'

                wmoparent = None
                if settings.importWMO:
                    wmoparent = bpy.data.objects.new('WMOs', None)
                    wmoparent.parent = obj
                    wmoparent.name = 'WMOs'
                    wmoparent.rotation_euler = [0, 0, 0]
                    wmoparent.rotation_euler.x = radians(-90)
                    collection.link(wmoparent)

                doodadparent = None
                if settings.importM2:
                    doodadparent = bpy.data.objects.new('Doodads', None)
                    doodadparent.parent = obj
                    doodadparent.name = 'Doodads'
                    doodadparent.rotation_euler = [0, 0, 0]
                    doodadparent.rotation_euler.x = radians(-90)
                    collection.link(doodadparent)

                gobjparent = None
                if settings.importGOBJ:
                    gobjparent = bpy.data.objects.new('GameObjects', None)
                    gobjparent.parent = obj
                    gobjparent.name = 'GameObjects'
                    gobjparent.rotation_euler = [0, 0, 0]
                    gobjparent.rotation_euler.x = radians(-90)
                    collection.link(gobjparent)
            else:
                importType = 'WMO'
                if not givenParent:
                    print('WMO import without given parent, creating..')
                    if settings.importWMOSets:
                        givenParent = bpy.data.objects.new('WMO parent', None)
                        givenParent.parent = obj
                        givenParent.name = 'Doodads'
                        givenParent.rotation_euler = [0, 0, 0]
                        givenParent.rotation_euler.x = radians(-90)
                        collection.link(givenParent)
            for row in reader:
                if importType == 'ADT':
                    if 'importedModelIDs' in bpy.context.scene:
                        tempModelIDList = bpy.context.scene['importedModelIDs']
                    else:
                        tempModelIDList = []
                    if row['ModelId'] in tempModelIDList:
                        if not settings.allowDuplicates:
                            print('Skipping already imported model ' + row['ModelId'])
                            continue
                    else:
                        tempModelIDList.append(row['ModelId'])

                    # ADT CSV
                    if row['Type'] == 'wmo' and settings.importWMO:
                        print('ADT WMO import: ' + row['ModelFile'])

                        # Make WMO parent that holds WMO and doodads
                        parent = bpy.data.objects.new(os.path.basename(row['ModelFile']) + ' parent', None)
                        parent.parent = wmoparent
                        parent.location = (max_size - float(row['PositionX']), (max_size - float(row['PositionZ'])) * -1, float(row['PositionY']))
                        parent.rotation_euler = [0, 0, 0]
                        parent.rotation_euler.x += radians(float(row['RotationZ']))
                        parent.rotation_euler.y += radians(float(row['RotationX']))
                        parent.rotation_euler.z = radians((90 + float(row['RotationY'])))

                        if row['ScaleFactor']:
                            parent.scale = (float(row['ScaleFactor']), float(row['ScaleFactor']), float(row['ScaleFactor']))

                        collection.link(parent)

                        if os.path.exists(os.path.join(baseDir, row['ModelFile'].replace('.obj', '_ModelPlacementInformation.csv'))):
                            # always import when it has doodad sets
                            importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), parent, settings, doodadSets=set(row['DoodadSetNames'].split(',')))
                        else:
                            if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                                importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), parent, settings)
                            else:
                                originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                                importedFile = originalObject.copy()
                                importedFile.data = originalObject.data.copy()
                                collection.link(importedFile)

                        importedFile.parent = parent
                    elif row['Type'] == 'm2' and settings.importM2:
                        print('ADT M2 import: ' + row['ModelFile'])

                        ## Only import OBJ if model is not yet in scene, otherwise copy existing
                        if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                            importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), None, settings)
                        else:
                            originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                            importedFile = originalObject.copy()
                            importedFile.rotation_euler = [0, 0, 0]
                            importedFile.rotation_euler.x = radians(90)
                            collection.link(importedFile)

                        importedFile.parent = doodadparent

                        importedFile.location.x = (max_size - float(row['PositionX']))
                        importedFile.location.y = (max_size - float(row['PositionZ'])) * -1
                        importedFile.location.z = float(row['PositionY'])
                        importedFile.rotation_euler.x += radians(float(row['RotationZ']))
                        importedFile.rotation_euler.y += radians(float(row['RotationX']))
                        importedFile.rotation_euler.z = radians(90 + float(row['RotationY']))
                        if row['ScaleFactor']:
                            importedFile.scale = (float(row['ScaleFactor']), float(row['ScaleFactor']), float(row['ScaleFactor']))
                    elif row['Type'] == 'gobj' and settings.importGOBJ:
                        if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                            importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), None, settings)
                        else:
                            originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                            importedFile = originalObject.copy()
                            importedFile.rotation_euler = [0, 0, 0]
                            importedFile.rotation_euler.x = radians(90)
                            collection.link(importedFile)

                        importedFile.parent = gobjparent
                        importedFile.location = (float(row['PositionY']), -float(row['PositionX']), float(row['PositionZ']))
                        rotQuat = Quaternion((float(row['RotationX']), float(row['RotationY']), -float(row['RotationZ']), float(row['RotationW'])))
                        rotEul = rotQuat.to_euler()
                        importedFile.rotation_euler = rotEul
                        if row['ScaleFactor']:
                            importedFile.scale = (float(row['ScaleFactor']), float(row['ScaleFactor']), float(row['ScaleFactor']))
                    bpy.context.scene['importedModelIDs'] = tempModelIDList
                elif settings.importWMOSets:
                    # WMO CSV
                    if doodadSets is not None and row['DoodadSet'] not in doodadSets:
                        continue

                    print('WMO M2 import: ' + row['ModelFile'])
                    if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                        importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), None, settings)
                    else:
                        originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                        importedFile = originalObject.copy()
                        collection.link(importedFile)

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
