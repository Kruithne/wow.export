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

# WoW coordinate system constants
MAX_SIZE = 51200 / 3
MAP_SIZE = MAX_SIZE * 2
ADT_SIZE = MAP_SIZE / 64
CHUNK_SIZE = 33.33333
TILE_SIZE = 533.33333

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


def isTerrainFile(fileName):
    return fileName.startswith('adt_')


def detectTextureMode(materials):
    singleTexturePattern = True
    
    for materialName in materials.keys():
        if not materialName.startswith('tex_'):
            continue
            
        parts = materialName.split('_')
        if len(parts) == 3:
            continue
        elif len(parts) == 4:
            singleTexturePattern = False
            break
        
    return 'EXTEND' if singleTexturePattern else 'CLIP'


def loadImage(textureLocation):
    imageName, imageExt = os.path.splitext(os.path.basename(textureLocation))
    imageName = normalizeName(imageName)

    if not imageName in bpy.data.images:
        loadedImage = bpy.data.images.load(textureLocation)
        loadedImage.name = imageName

    return bpy.data.images[imageName]

def createStandardMaterial(materialName, textureLocation, blendMode, createEmissive, extension_mode='REPEAT'):
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
    image.extension = extension_mode

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



def get_mix_node_sockets(mix_node):
    """Get mix node socket indices for cross-version compatibility"""
    sockets = {'in': {}, 'out': {}}
    input_index = 0
    
    for idx, socket in enumerate(mix_node.inputs):
        if 'Fac' in socket.name and socket.type == 'VALUE':
            sockets['in']['Factor'] = idx
        elif socket.type == 'RGBA':
            sockets['in'][('A', 'B')[input_index]] = idx
            input_index += 1

    for idx, socket in enumerate(mix_node.outputs):
        if socket.type == 'RGBA':
            sockets['out']['Result'] = idx
    
    return sockets

def createLiquidMaterial(materialName, liquidType):
    material = bpy.data.materials.new(name=materialName)
    material.use_nodes = True
    material.blend_method = 'BLEND'
    
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
    
    if not outNode:
        outNode = nodes.new('ShaderNodeOutputMaterial')
        outNode.location = (300, 400)
    
    if not principled:
        principled = nodes.new('ShaderNodeBsdfPrincipled')
        principled.location = (0, 400)
        node_tree.links.new(principled.outputs['BSDF'], outNode.inputs['Surface'])
    
    # Ocean (type 1)
    if liquidType == 1:
        principled.inputs['Base Color'].default_value = (0.1, 0.3, 0.6, 1.0)
        principled.inputs['Alpha'].default_value = 0.8
        if IS_B40:
            principled.inputs['Transmission Weight'].default_value = 1.0
        else:
            principled.inputs['Transmission'].default_value = 1.0
    # Magma (type 2 in newer builds, type 6 in older)
    elif liquidType == 2 or liquidType == 6:
        principled.inputs['Base Color'].default_value = (1.0, 0.3, 0.1, 1.0)
        principled.inputs['Alpha'].default_value = 0.9
        principled.inputs['Emission Strength' if IS_B40 else 'Emission'].default_value = 0.5
    # Slime (type 3)
    elif liquidType == 3:
        principled.inputs['Base Color'].default_value = (0.3, 0.8, 0.2, 1.0)
        principled.inputs['Alpha'].default_value = 0.8
    # River (type 4) - clear blue water
    elif liquidType == 4:
        principled.inputs['Base Color'].default_value = (0.2, 0.5, 0.8, 1.0)
        principled.inputs['Alpha'].default_value = 0.7
        if IS_B40:
            principled.inputs['Transmission Weight'].default_value = 1.0
        else:
            principled.inputs['Transmission'].default_value = 1.0
    # Default liquid
    else:
        principled.inputs['Base Color'].default_value = (0.3, 0.6, 0.9, 1.0)
        principled.inputs['Alpha'].default_value = 0.6
        if IS_B40:
            principled.inputs['Transmission Weight'].default_value = 0.8
        else:
            principled.inputs['Transmission'].default_value = 0.8
    
    principled.inputs[SPECULAR_INPUT_NAME].default_value = 0.8
    principled.inputs['Roughness'].default_value = 0.1
    
    return material


def importLiquidChunks(liquidFile, baseObj, settings):
    print(f'Attempting to import liquid from: {liquidFile}')
    
    try:
        with open(liquidFile, 'r', encoding='utf-8') as fp:
            liquid_data = json.load(fp)
        print(f'Successfully loaded liquid JSON with keys: {list(liquid_data.keys())}')
    except Exception as e:
        print(f'Could not read liquid data from {liquidFile}: {e}')
        return
    
    if 'liquidChunks' not in liquid_data:
        print('No liquidChunks found in JSON data')
        return
    
    liquidparent = bpy.data.objects.new('Liquids', None)
    liquidparent.parent = baseObj
    liquidparent.name = 'Liquids'
    liquidparent.rotation_euler = [0, 0, 0]
    liquidparent.rotation_euler.x = radians(-90)
    
    collection = bpy.context.view_layer.active_layer_collection.collection.objects
    collection.link(liquidparent)
    
    liquidChunks = liquid_data['liquidChunks']
    print(f'Processing {len(liquidChunks)} liquid chunk slots')
    
    liquid_objects_created = 0
    
    for chunk_idx, chunk in enumerate(liquidChunks):
        if not chunk or chunk is None:
            continue
            
        if not chunk.get('instances') or not isinstance(chunk.get('instances'), list):
            continue
            
        chunk_x = chunk_idx % 16
        chunk_y = chunk_idx // 16
        
        print(f'Processing chunk {chunk_idx} ({chunk_x}, {chunk_y}) with {len(chunk["instances"])} instances')
        
        for instance_idx, instance in enumerate(chunk['instances']):
            if not instance or instance is None:
                continue
                
            liquid_type = instance.get('liquidType', 2)
            width = instance.get('width', 8)
            height = instance.get('height', 8)
            x_offset = instance.get('xOffset', 0)
            y_offset = instance.get('yOffset', 0)
            min_height = instance.get('minHeightLevel', 0.0)
            max_height = instance.get('maxHeightLevel', 0.0)
            
            vertex_data = instance.get('vertexData', {})
            height_map = vertex_data.get('height', [])
            bitmap = instance.get('bitmap', [])
            
            print(f'  Instance {instance_idx}: type={liquid_type}, size={width}x{height}, offset=({x_offset},{y_offset}), heights={min_height:.2f}-{max_height:.2f}')
            print(f'    Height map: {len(height_map)} values, Bitmap: {len(bitmap)} bytes')
            
            world_position = instance.get('worldPosition')
            terrain_chunk_pos = instance.get('terrainChunkPosition')
            print(f'    Using world coordinates: {world_position}')
            print(f'    Terrain chunk position: {terrain_chunk_pos}')
            
            # Skip instances with no geometry
            if width <= 0 or height <= 0:
                continue
            
            mesh_name = f'Liquid_Chunk_{chunk_x:02d}_{chunk_y:02d}_{instance_idx}'
            mesh = bpy.data.meshes.new(mesh_name)
            liquid_obj = bpy.data.objects.new(mesh_name, mesh)
            
            liquid_obj.parent = liquidparent
            collection.link(liquid_obj)
            
            bm = bmesh.new()
            
            # Create vertices
            vertices = []
            vertex_count = (width + 1) * (height + 1)
            
            for y in range(height + 1):
                for x in range(width + 1):
                    vert_idx = y * (width + 1) + x
                    
                    # Calculate vertex offset from the instance center
                    vertex_offset_x = (x - width / 2) * (CHUNK_SIZE / 8.0)
                    vertex_offset_y = (y - height / 2) * (CHUNK_SIZE / 8.0)
                    
                    # Apply same coordinate transformation as terrain
                    # world_position[0] = worldX (from chunkY), world_position[2] = worldZ (from chunkX)
                    # Terrain subtracts offsets, so we subtract vertex offsets from world position
                    world_x = world_position[0] - vertex_offset_x  # worldX - x_offset
                    world_y = -(world_position[2] - vertex_offset_y)  # Negate to fix Y-axis direction
                    
                    # Get height from height map or use default
                    if height_map and vert_idx < len(height_map):
                        world_z = height_map[vert_idx]
                    elif not height_map:
                        # Use the world position height when no height map is available
                        world_z = world_position[1]
                    elif min_height == max_height:
                        world_z = min_height
                    else:
                        world_z = (min_height + max_height) / 2.0
                    
                    vert = bm.verts.new((world_x, world_y, world_z))
                    vertices.append(vert)
            
            bm.verts.ensure_lookup_table()
            
            # Create faces based on bitmap or create all faces if no bitmap
            faces_created = 0
            bitmap_idx = 0
            
            for y in range(height):
                for x in range(width):
                    should_create_face = True
                    
                    # Check bitmap to see if this face should exist
                    if bitmap and len(bitmap) > 0:
                        byte_idx = bitmap_idx // 8
                        bit_idx = bitmap_idx % 8
                        if byte_idx < len(bitmap):
                            bit_value = (bitmap[byte_idx] >> bit_idx) & 1
                            should_create_face = bool(bit_value)
                        bitmap_idx += 1
                    
                    if should_create_face:
                        # Create quad face (counter-clockwise winding)
                        try:
                            v1 = vertices[y * (width + 1) + x]
                            v2 = vertices[y * (width + 1) + (x + 1)]
                            v3 = vertices[(y + 1) * (width + 1) + (x + 1)]
                            v4 = vertices[(y + 1) * (width + 1) + x]
                            
                            face = bm.faces.new([v1, v2, v3, v4])
                            face.smooth = True
                            faces_created += 1
                        except ValueError as e:
                            # Skip degenerate faces
                            print(f'    Warning: Could not create face at ({x},{y}): {e}')
                            pass
            
            print(f'    Created {len(vertices)} vertices and {faces_created} faces')
            
            # Only create object if we have geometry
            if faces_created > 0:
                bm.to_mesh(mesh)
                
                if settings.importTextures:
                    material_name = f'Liquid_Type_{liquid_type}'
                    material = bpy.data.materials.get(material_name)
                    if material is None:
                        material = createLiquidMaterial(material_name, liquid_type)
                    
                    liquid_obj.data.materials.append(material)
                
                liquid_obj.location = (0, 0, 0)
                liquid_objects_created += 1
            else:
                collection.unlink(liquid_obj)
                bpy.data.objects.remove(liquid_obj)
                bpy.data.meshes.remove(mesh)
                print(f'    Skipped empty liquid instance')
            
            bm.free()
    
    # Remove parent if no liquid objects were created
    if liquid_objects_created == 0:
        collection.unlink(liquidparent)
        bpy.data.objects.remove(liquidparent)
        print('No liquid geometry found, removed empty parent object')
    else:
        print(f'Liquid import complete: Created {liquid_objects_created} liquid objects')



def get_m2_shader_effects(shader_id, texture_count=2):
    """Get pixel shader name using WoW's M2GetPixelShaderID logic"""
    if shader_id & 0x8000:
        shader_id &= (~0x8000)
        ind = shader_id.bit_length()
        return "PS_Combiners_Opaque"
    else:
        if texture_count == 1:
            if shader_id & 0x70:
                return "PS_Combiners_Mod"
            else:
                return "PS_Combiners_Opaque"
        else:
            lower = shader_id & 7
            if shader_id & 0x70:
                if lower == 0:
                    return "PS_Combiners_Mod_Opaque"
                elif lower == 3:
                    return "PS_Combiners_Mod_Add"
                elif lower == 4:
                    return "PS_Combiners_Mod_Mod2x"
                elif lower == 6:
                    return "PS_Combiners_Mod_Mod2xNA"
                elif lower == 7:
                    return "PS_Combiners_Mod_AddNA"
                else:
                    return "PS_Combiners_Mod_Mod"
            else:
                if lower == 0:
                    return "PS_Combiners_Opaque_Opaque"
                elif lower == 3:
                    return "PS_Combiners_Opaque_AddAlpha"
                elif lower == 4:
                    return "PS_Combiners_Opaque_Mod2x"
                elif lower == 6:
                    return "PS_Combiners_Opaque_Mod2xNA"
                elif lower == 7:
                    return "PS_Combiners_Opaque_AddAlpha"
                else:
                    return "PS_Combiners_Opaque_Mod"

def get_m2_vertex_shader(shader_id, texture_count=2):
    """Get vertex shader name using WoW's vertex shader logic"""
    if shader_id & 0x8000:
        shader_id &= (~0x8000)
        return "VS_Diffuse_T1_T1"
    else:
        if texture_count == 1:
            if shader_id & 0x80:
                return "VS_Diffuse_Env"
            else:
                if shader_id & 0x4000:
                    return "VS_Diffuse_T2"
                else:
                    return "VS_Diffuse_T1"
        else:
            if shader_id & 0x80:
                if shader_id & 0x8:
                    return "VS_Diffuse_Env_Env"
                else:
                    return "VS_Diffuse_Env_T1"
            else:
                if shader_id & 0x8:
                    return "VS_Diffuse_T1_Env"
                else:
                    if shader_id & 0x4000:
                        return "VS_Diffuse_T1_T2"
                    else:
                        return "VS_Diffuse_T1_T1"

def get_m2_render_flags(flags):
    render_flags = {
        'unlit': bool(flags & 0x1),
        'unfogged': bool(flags & 0x2),
        'two_sided': bool(flags & 0x4),
        'depth_test': not bool(flags & 0x10),
        'depth_write': not bool(flags & 0x20)
    }
    return render_flags

def has_advanced_m2_data(json_info):
    return (json_info.get('fileType') == 'm2' and 
            'skin' in json_info and 
            'textureUnits' in json_info['skin'])

def createAdvancedM2Material(material_name, texture_unit, materials, textures, texture_combos, settings, base_dir):
    shader_id = texture_unit['shaderID']
    texture_count = texture_unit['textureCount']
    material_index = texture_unit['materialIndex']
    texture_combo_index = texture_unit.get('textureComboIndex', 0)
    
    material = bpy.data.materials.new(name=material_name)
    material.use_nodes = True
    
    material_data = materials[material_index] if material_index < len(materials) else {}
    blending_mode = material_data.get('blendingMode', 0)
    material_flags = material_data.get('flags', 0)
    
    render_flags = get_m2_render_flags(material_flags)
    pixel_shader = get_m2_shader_effects(shader_id, texture_count)
    vertex_shader = get_m2_vertex_shader(shader_id, texture_count)
    
    if blending_mode in {2, 4}:
        material.blend_method = 'BLEND'
    elif blending_mode in {1, 5}:
        material.blend_method = 'CLIP'
    else:
        material.blend_method = 'OPAQUE'
    
    node_tree = material.node_tree
    nodes = node_tree.nodes
    
    principled = None
    out_node = None
    
    for node in nodes:
        if not principled and node.type == 'BSDF_PRINCIPLED':
            principled = node
        if not out_node and node.type == 'OUTPUT_MATERIAL':
            out_node = node
        if principled and out_node:
            break
    
    if not out_node:
        out_node = nodes.new('ShaderNodeOutputMaterial')
        out_node.location = (300, 400)
    
    if not principled:
        principled = nodes.new('ShaderNodeBsdfPrincipled')
        principled.location = (0, 400)
        node_tree.links.new(principled.outputs['BSDF'], out_node.inputs['Surface'])
    
    principled.inputs[SPECULAR_INPUT_NAME].default_value = 0
    
    texture_nodes = []
    tex_x_offset = -600
    
    # Resolve texture indices using texture combos system
    texture_indices = []
    if texture_combo_index < len(texture_combos) and texture_count > 0:
        combo_end = min(texture_combo_index + texture_count, len(texture_combos))
        texture_indices = texture_combos[texture_combo_index:combo_end]
    
    for i, texture_index in enumerate(texture_indices):
        if texture_index < len(textures):
            texture_data = textures[texture_index]
            texture_filename = texture_data.get('fileNameExternal', '')
            
            if not texture_filename:
                continue
            
            # Handle path resolution for M2 textures
            if os.path.isabs(texture_filename):
                texture_path = texture_filename
            else:
                # Convert backslashes to forward slashes and resolve relative paths
                normalized_filename = texture_filename.replace('\\', '/')
                texture_path = os.path.normpath(os.path.join(base_dir, normalized_filename))
            
            try:
                image_node = nodes.new('ShaderNodeTexImage')
                image_node.location = (tex_x_offset + i * 250, 200 - i * 200)
                image_node.image = loadImage(texture_path)
                image_node.image.alpha_mode = 'CHANNEL_PACKED'
                texture_nodes.append(image_node)
            except Exception as e:
                print(f"Failed to load texture {texture_filename}: {e}")
                continue
    
    if not texture_nodes:
        return material
    
    main_texture = texture_nodes[0]
    
    if blending_mode == 4 and settings.createEmissiveMaterials:
        nodes.remove(principled)
        emission = nodes.new('ShaderNodeEmission')
        emission.location = (0, 400)
        node_tree.links.new(main_texture.outputs['Color'], emission.inputs['Color'])
        
        transparent = nodes.new('ShaderNodeBsdfTransparent')
        transparent.location = (0, 200)
        
        add_shader = nodes.new('ShaderNodeAddShader')
        add_shader.location = (200, 300)
        node_tree.links.new(transparent.outputs['BSDF'], add_shader.inputs[0])
        node_tree.links.new(emission.outputs['Emission'], add_shader.inputs[1])
        node_tree.links.new(add_shader.outputs['Shader'], out_node.inputs['Surface'])
        
        if len(texture_nodes) > 1:
            node_tree.links.new(texture_nodes[1].outputs['Alpha'], emission.inputs['Strength'])
    elif blending_mode == 3:
        nodes.remove(principled)
        emission = nodes.new('ShaderNodeEmission')
        emission.location = (0, 400)
        node_tree.links.new(main_texture.outputs['Color'], emission.inputs['Color'])
        node_tree.links.new(emission.outputs['Emission'], out_node.inputs['Surface'])
    elif blending_mode in {5, 6}:
        mix_shader = nodes.new('ShaderNodeMixShader')
        mix_shader.location = (100, 400)
        
        transparent = nodes.new('ShaderNodeBsdfTransparent')
        transparent.location = (-100, 200)
        
        node_tree.links.new(transparent.outputs['BSDF'], mix_shader.inputs[1])
        node_tree.links.new(principled.outputs['BSDF'], mix_shader.inputs[2])
        node_tree.links.new(mix_shader.outputs['Shader'], out_node.inputs['Surface'])
        
        if texture_nodes:
            alpha_texture = texture_nodes[1] if len(texture_nodes) > 1 else main_texture
            node_tree.links.new(alpha_texture.outputs['Alpha'], mix_shader.inputs['Fac'])
    elif blending_mode == 7:
        multiply_mix = None
        try:
            multiply_mix = nodes.new('ShaderNodeMix')
            multiply_mix.data_type = 'RGBA'
            multiply_mix.blend_type = 'MULTIPLY'
        except:
            multiply_mix = nodes.new('ShaderNodeMixRGB')
            multiply_mix.blend_type = 'MULTIPLY'
        
        multiply_mix.location = (-200, 400)
        
        sockets = get_mix_node_sockets(multiply_mix)
        
        multiply_mix.inputs[sockets['in']['Factor']].default_value = 1.0
        node_tree.links.new(main_texture.outputs['Color'], multiply_mix.inputs[sockets['in']['A']])
        
        if len(texture_nodes) > 1:
            node_tree.links.new(texture_nodes[1].outputs['Color'], multiply_mix.inputs[sockets['in']['B']])
        else:
            multiply_mix.inputs[sockets['in']['B']].default_value = [1.0, 1.0, 1.0, 1.0]
        
        node_tree.links.new(multiply_mix.outputs[sockets['out']['Result']], principled.inputs['Base Color'])
    elif blending_mode == 8:
        multiply_mix = None
        try:
            multiply_mix = nodes.new('ShaderNodeMix')
            multiply_mix.data_type = 'RGBA'
            multiply_mix.blend_type = 'MULTIPLY'
        except:
            multiply_mix = nodes.new('ShaderNodeMixRGB')
            multiply_mix.blend_type = 'MULTIPLY'
        
        multiply_mix.location = (-200, 400)
        
        sockets = get_mix_node_sockets(multiply_mix)
        
        multiply_mix.inputs[sockets['in']['Factor']].default_value = 1.0
        node_tree.links.new(main_texture.outputs['Color'], multiply_mix.inputs[sockets['in']['A']])
        
        multiply_mix.inputs[sockets['in']['B']].default_value = [2.0, 2.0, 2.0, 1.0]
        
        if len(texture_nodes) > 1:
            math_multiply = nodes.new('ShaderNodeMath')
            math_multiply.operation = 'MULTIPLY'
            math_multiply.location = (-400, 200)
            math_multiply.inputs[1].default_value = 2.0
            
            node_tree.links.new(texture_nodes[1].outputs['Color'], math_multiply.inputs[0])
            node_tree.links.new(math_multiply.outputs['Value'], multiply_mix.inputs[sockets['in']['B']])
        
        node_tree.links.new(multiply_mix.outputs[sockets['out']['Result']], principled.inputs['Base Color'])
    else:
        if len(texture_nodes) > 1 and pixel_shader in {'TWO_LAYER_DIFFUSE', 'TWO_LAYER_DIFFUSE_ALPHA'}:
            mix_node = None
            try:
                mix_node = nodes.new('ShaderNodeMix')
                mix_node.data_type = 'RGBA'
            except:
                mix_node = nodes.new('ShaderNodeMixRGB')
            
            mix_node.location = (-200, 400)
            
            sockets = get_mix_node_sockets(mix_node)
            
            node_tree.links.new(main_texture.outputs['Color'], mix_node.inputs[sockets['in']['A']])
            node_tree.links.new(texture_nodes[1].outputs['Color'], mix_node.inputs[sockets['in']['B']])
            
            if len(texture_nodes) > 2:
                node_tree.links.new(texture_nodes[2].outputs['Alpha'], mix_node.inputs[sockets['in']['Factor']])
            else:
                mix_node.inputs[sockets['in']['Factor']].default_value = 0.5
            
            node_tree.links.new(mix_node.outputs[sockets['out']['Result']], principled.inputs['Base Color'])
        else:
            node_tree.links.new(main_texture.outputs['Color'], principled.inputs['Base Color'])
    
    if blending_mode not in {3, 4} and blending_mode != 0 and texture_nodes:
        alpha_texture = texture_nodes[1] if len(texture_nodes) > 1 else main_texture
        if blending_mode not in {5, 6}:
            node_tree.links.new(alpha_texture.outputs['Alpha'], principled.inputs['Alpha'])
    
    return material

def createBlendedTerrain(materialName, textureLocation, layers, baseDir, extension_mode='REPEAT'):
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
        base_layer.extension = extension_mode
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

            sockets = get_mix_node_sockets(mix_node)

            node_tree.links.new(
                alpha_map_channels.outputs[idx],
                mix_node.inputs[sockets['in']['Factor']])

            if last_mix_node is None:
                node_tree.links.new(
                    base_layer.outputs['Color'],
                    mix_node.inputs[sockets['in']['A']])
            else:
                node_tree.links.new(
                    last_mix_node.outputs[sockets['out']['Result']],
                    mix_node.inputs[sockets['in']['A']])

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
            layer_texture.extension = extension_mode
            layer_texture.hide = True
            layer_texture.parent = layer_frame
            last_tex_node_pos += 420

            node_tree.links.new(texture_mapping_layer.outputs['Vector'], layer_texture.inputs['Vector'])
            node_tree.links.new(
                layer_texture.outputs['Color'],
                mix_node.inputs[sockets['in']['B']])

            last_mix_node = mix_node

        if last_mix_node is None:
            node_tree.links.new(base_layer.outputs['Color'], principled.inputs['Base Color'])
        else:
            # Get sockets for the last mix node - we know it exists since last_mix_node is not None
            sockets = get_mix_node_sockets(last_mix_node)
            node_tree.links.new(
                last_mix_node.outputs[sockets['out']['Result']],
                principled.inputs['Base Color'])

        return material
    except Exception as e:
        print('failed to create terrain material for %s' % materialName)
        print(e)
        bpy.data.materials.remove(material)

def importWoWOBJ(objectFile, givenParent = None, settings = None):
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
                # Create mapping from skin section index to texture unit
                json_info['skinTexUnits'] = {i['skinSectionIndex']: i for i in json_info['skin']['textureUnits']}
                # Create mapping from mesh name to skin section index for proper lookup
                json_info['meshToSkinSection'] = {}
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
                # Extract skin section index from mesh name for M2 files
                if json_info.get('fileType') == 'm2':
                    mesh_name = meshes[meshIndex].name
                    # Mesh names are typically like 'Geoset_000', extract the number
                    try:
                        skin_section_idx = int(mesh_name.split('_')[-1])
                        json_info['meshToSkinSection'][meshIndex] = skin_section_idx
                    except (ValueError, IndexError):
                        # Fallback: use mesh index if name parsing fails
                        json_info['meshToSkinSection'][meshIndex] = meshIndex
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
        
        # Detect terrain file and texture extension mode
        terrainFile = isTerrainFile(fileName)
        textureExtensionMode = 'REPEAT'
        if terrainFile:
            textureExtensionMode = detectTextureMode(materials)

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
                        material = createBlendedTerrain(materialName, textureLocation, material_json['layers'], baseDir, textureExtensionMode)
                
                if material is None and materialName in usedMaterials:
                    if has_advanced_m2_data(json_info):
                        # Find the FIRST mesh that uses this material to get the correct texture unit
                        texture_unit_found = None
                        for mesh_idx, mesh in enumerate(meshes):
                            if mesh.usemtl == materialName or mesh.usemtl.startswith(materialName + '_B'):
                                # Use the mesh to skin section mapping
                                skin_section_idx = json_info['meshToSkinSection'].get(mesh_idx, mesh_idx)
                                if skin_section_idx in json_info.get('skinTexUnits', {}):
                                    texture_unit_found = json_info['skinTexUnits'][skin_section_idx]
                                    break
                        
                        if texture_unit_found:
                            json_materials = json_info.get('materials', [])
                            json_textures = json_info.get('textures', [])
                            json_texture_combos = json_info.get('textureCombos', [])
                            material = createAdvancedM2Material(materialName, texture_unit_found, json_materials, json_textures, json_texture_combos, settings, baseDir)
                        else:
                            material = createStandardMaterial(materialName, textureLocation, -1, False, textureExtensionMode)
                    else:
                        material = createStandardMaterial(materialName, textureLocation, -1, False, textureExtensionMode)

            if settings.useAlpha:
                for bm, (materialBName, materialBMat) in materialB.items():
                    # create materials with different blending modes
                    if materialBName in usedMaterials and materialBMat is None:
                        if has_advanced_m2_data(json_info):
                            # Find the mesh that uses this blend mode material
                            texture_unit_found = None
                            for mesh_idx, mesh in enumerate(meshes):
                                if mesh.usemtl == materialBName:
                                    skin_section_idx = json_info['meshToSkinSection'].get(mesh_idx, mesh_idx)
                                    if skin_section_idx in json_info.get('skinTexUnits', {}):
                                        texture_unit_found = json_info['skinTexUnits'][skin_section_idx]
                                        break
                            
                            if texture_unit_found:
                                json_materials = json_info.get('materials', [])
                                json_textures = json_info.get('textures', [])
                                json_texture_combos = json_info.get('textureCombos', [])
                                materialB[bm] = (materialBName, createAdvancedM2Material(materialBName, texture_unit_found, json_materials, json_textures, json_texture_combos, settings, baseDir))
                            else:
                                materialB[bm] = (materialBName, createStandardMaterial(materialBName, textureLocation, bm, settings.createEmissiveMaterials, textureExtensionMode))
                        else:
                            materialB[bm] = (materialBName, createStandardMaterial(materialBName, textureLocation, bm, settings.createEmissiveMaterials, textureExtensionMode))

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


    ## Import liquids
    if settings.importLiquid:
        baseDir, fileName = os.path.split(objectFile)
        baseName = fileName[:fileName.rfind('.')]
        tileID = baseName.replace('adt_', '') if baseName.startswith('adt_') else baseName
        liquidPath = os.path.join(baseDir, f'liquid_{tileID}.json')
        print(f'Checking for liquid file: {liquidPath}')
        if os.path.exists(liquidPath):
            print(f'Liquid file found! Importing liquid data from {liquidPath}')
            importLiquidChunks(liquidPath, obj, settings)
        else:
            print(f'No liquid file found at {liquidPath}')

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
                        parent.location = (MAX_SIZE - float(row['PositionX']), (MAX_SIZE - float(row['PositionZ'])) * -1, float(row['PositionY']))
                        parent.rotation_euler = [0, 0, 0]
                        parent.rotation_euler.x += radians(float(row['RotationZ']))
                        parent.rotation_euler.y += radians(float(row['RotationX']))
                        parent.rotation_euler.z = radians((90 + float(row['RotationY'])))

                        if row['ScaleFactor']:
                            parent.scale = (float(row['ScaleFactor']), float(row['ScaleFactor']), float(row['ScaleFactor']))

                        collection.link(parent)

                        ## Only import OBJ if model is not yet in scene, otherwise copy existing
                        if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                            importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), parent, settings)
                        else:
                            ## Don't copy WMOs with doodads!
                            if os.path.exists(os.path.join(baseDir, row['ModelFile'].replace('.obj', '_ModelPlacementInformation.csv'))):
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

                        importedFile.location.x = (MAX_SIZE - float(row['PositionX']))
                        importedFile.location.y = (MAX_SIZE - float(row['PositionZ'])) * -1
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
                    print('WMO M2 import: ' + row['ModelFile'])
                    if os.path.basename(row['ModelFile']) not in bpy.data.objects:
                        importedFile = importWoWOBJ(os.path.join(baseDir, row['ModelFile']), None, settings)
                    else:
                        originalObject = bpy.data.objects[os.path.basename(row['ModelFile'])]
                        importedFile = originalObject.copy()
                        if not settings.createDoodadSetCollections:
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

                    if settings.createDoodadSetCollections:
                        if row['DoodadSet']:
                            print("Valid DoodadSet found: " + row['DoodadSet'])
                            collectionName = row['DoodadSet']
                            collection = bpy.data.collections.get(collectionName)
                            
                            if collection is None:
                                print("Collection for " + collectionName + " does not exist. Creating collection..")
                                collection = bpy.data.collections.new(collectionName)
                                bpy.context.scene.collection.children.link(collection)
                            
                            if collection.name not in bpy.context.scene.collection.children:
                                print("Collection " + collectionName + " isn't linked to scene. Linking collection..")
                                bpy.context.scene.collection.children.link(collection)

                            if collection:
                                print("Valid collection present. Linking " + importedFile.name)
                                collection.objects.link(importedFile)
    return obj
