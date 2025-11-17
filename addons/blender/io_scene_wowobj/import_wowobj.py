import bpy
import bmesh
import os
import csv
import hashlib
import json
from collections import defaultdict

from math import radians
from mathutils import Quaternion
from .animation_processor import process_texture_transform

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


def create_texture_panner_node_group():
    """Create reusable TexturePanner node group for UV animation"""
    group_name = "TexturePanner"
    
    if group_name in bpy.data.node_groups:
        return bpy.data.node_groups[group_name]
    
    group = bpy.data.node_groups.new(group_name, 'ShaderNodeTree')
    group.nodes.clear()
    
    if hasattr(group, 'interface'):
        # Blender 4.0+ interface system
        group.interface.new_socket('UV', in_out='INPUT', socket_type='NodeSocketVector')
        group.interface.new_socket('Translate X Rate', in_out='INPUT', socket_type='NodeSocketFloat')
        group.interface.new_socket('Translate Y Rate', in_out='INPUT', socket_type='NodeSocketFloat')
        group.interface.new_socket('Rotate Rate', in_out='INPUT', socket_type='NodeSocketFloat')
        group.interface.new_socket('Scale X Rate', in_out='INPUT', socket_type='NodeSocketFloat')
        group.interface.new_socket('Scale Y Rate', in_out='INPUT', socket_type='NodeSocketFloat')
        group.interface.new_socket('UV', in_out='OUTPUT', socket_type='NodeSocketVector')
    else:
        # Blender 3.x interface system
        group.inputs.new('NodeSocketVector', 'UV')
        group.inputs.new('NodeSocketFloat', 'Translate X Rate')
        group.inputs.new('NodeSocketFloat', 'Translate Y Rate')
        group.inputs.new('NodeSocketFloat', 'Rotate Rate')
        group.inputs.new('NodeSocketFloat', 'Scale X Rate')
        group.inputs.new('NodeSocketFloat', 'Scale Y Rate')
        group.outputs.new('NodeSocketVector', 'UV')
    
    nodes = group.nodes
    links = group.links
    
    group_input = nodes.new('NodeGroupInput')
    group_input.location = (-800, 0)
    
    group_output = nodes.new('NodeGroupOutput')
    group_output.location = (600, 0)
    
    driver_node = nodes.new('ShaderNodeValue')
    driver_node.name = "TimeDriver"
    driver_node.location = (-600, 300)
    driver_node.label = "Frame"
    
    # 0.01 factor smooths the animation. probably a more accurate value for this.
    smooth_mult = nodes.new('ShaderNodeMath')
    smooth_mult.operation = 'MULTIPLY'
    smooth_mult.location = (-450, 300)
    smooth_mult.label = "Smooth Time"
    smooth_mult.inputs[1].default_value = 0.01
    
    translate_x_mult = nodes.new('ShaderNodeMath')
    translate_x_mult.operation = 'MULTIPLY'
    translate_x_mult.location = (-300, 200)
    translate_x_mult.label = "Translate X"
    
    translate_y_mult = nodes.new('ShaderNodeMath')
    translate_y_mult.operation = 'MULTIPLY'
    translate_y_mult.location = (-300, 100)
    translate_y_mult.label = "Translate Y"
    
    combine_translate = nodes.new('ShaderNodeCombineXYZ')
    combine_translate.location = (-100, 150)
    combine_translate.label = "Translation"
    
    add_translate = nodes.new('ShaderNodeVectorMath')
    add_translate.operation = 'ADD'
    add_translate.location = (100, 0)
    add_translate.label = "Apply Translation"
    
    try:
        driver = driver_node.outputs[0].driver_add("default_value")
        driver.driver.expression = "frame"
        while len(driver.driver.variables) > 0:
            driver.driver.variables.remove(driver.driver.variables[0])
    except Exception as e:
        print(f"Failed to create driver: {e}")
        driver_node.outputs[0].default_value = 1.0
    
    # Frame to smooth multiplier
    links.new(driver_node.outputs[0], smooth_mult.inputs[0])
    
    # Smooth time to rate multipliers
    links.new(smooth_mult.outputs[0], translate_x_mult.inputs[0])
    links.new(smooth_mult.outputs[0], translate_y_mult.inputs[0])
    
    # Group inputs to rate multipliers
    links.new(group_input.outputs['Translate X Rate'], translate_x_mult.inputs[1])
    links.new(group_input.outputs['Translate Y Rate'], translate_y_mult.inputs[1])
    
    # Rate calculations to combine node
    links.new(translate_x_mult.outputs[0], combine_translate.inputs['X'])
    links.new(translate_y_mult.outputs[0], combine_translate.inputs['Y'])
    
    # UV input to translation
    links.new(group_input.outputs['UV'], add_translate.inputs[0])
    links.new(combine_translate.outputs[0], add_translate.inputs[1])
    
    # Final result to group output
    links.new(add_translate.outputs[0], group_output.inputs['UV'])
    
    return group


def create_competitive_blend_node_group():
	"""create reusable competitive terrain blending node group"""
	group_name = 'competitive_terrain_blend'

	if group_name in bpy.data.node_groups:
		return bpy.data.node_groups[group_name]

	group = bpy.data.node_groups.new(group_name, 'ShaderNodeTree')
	group.nodes.clear()

	if hasattr(group, 'interface'):
		# blender 4.0+ interface system
		for i in range(8):
			group.interface.new_socket(f'diffuse_{i}', in_out='INPUT', socket_type='NodeSocketColor')
			group.interface.new_socket(f'height_{i}', in_out='INPUT', socket_type='NodeSocketFloat')
			if i > 0:  # skip alpha_0 since it's unused
				group.interface.new_socket(f'alpha_{i}', in_out='INPUT', socket_type='NodeSocketFloat')
			group.interface.new_socket(f'height_scale_{i}', in_out='INPUT', socket_type='NodeSocketFloat')
			group.interface.new_socket(f'height_offset_{i}', in_out='INPUT', socket_type='NodeSocketFloat')
		group.interface.new_socket('result', in_out='OUTPUT', socket_type='NodeSocketColor')
	else:
		# blender 3.x interface system
		for i in range(8):
			group.inputs.new('NodeSocketColor', f'diffuse_{i}')
			group.inputs.new('NodeSocketFloat', f'height_{i}')
			if i > 0:  # skip alpha_0 since it's unused
				group.inputs.new('NodeSocketFloat', f'alpha_{i}')
			group.inputs.new('NodeSocketFloat', f'height_scale_{i}')
			group.inputs.new('NodeSocketFloat', f'height_offset_{i}')
		group.outputs.new('NodeSocketColor', 'result')

	nodes = group.nodes
	links = group.links

	group_input = nodes.new('NodeGroupInput')
	group_input.location = (-2000, 0)

	group_output = nodes.new('NodeGroupOutput')
	group_output.location = (800, 0)

	# calculate alpha sum for base layer weight (layer 0)
	# we need to sum alpha_1 through alpha_7 (6 additions total)
	alpha_sum_adds = []
	for i in range(6):  # 6 add nodes for 7 alpha inputs (1-7)
		add_node = nodes.new('ShaderNodeMath')
		add_node.operation = 'ADD'
		add_node.location = (-1700 + i * 50, 800)
		alpha_sum_adds.append(add_node)

	# chain alpha additions (sum alpha_1 through alpha_7)
	for i in range(len(alpha_sum_adds)):
		if i == 0:
			# first add: alpha_1 + alpha_2
			links.new(group_input.outputs['alpha_1'], alpha_sum_adds[i].inputs[0])
			links.new(group_input.outputs['alpha_2'], alpha_sum_adds[i].inputs[1])
		else:
			# subsequent adds: previous_sum + alpha_(i+2)
			links.new(alpha_sum_adds[i-1].outputs[0], alpha_sum_adds[i].inputs[0])
			alpha_index = i + 2
			if alpha_index < 8:  # ensure we don't go beyond alpha_7
				links.new(group_input.outputs[f'alpha_{alpha_index}'], alpha_sum_adds[i].inputs[1])

	# clamp alpha sum to 0-1
	alpha_sum_clamp = nodes.new('ShaderNodeClamp')
	alpha_sum_clamp.location = (-1200, 800)
	alpha_sum_clamp.inputs['Min'].default_value = 0.0
	alpha_sum_clamp.inputs['Max'].default_value = 1.0
	links.new(alpha_sum_adds[-1].outputs[0], alpha_sum_clamp.inputs['Value'])

	# calculate base layer weight: 1.0 - alpha_sum
	base_weight_sub = nodes.new('ShaderNodeMath')
	base_weight_sub.operation = 'SUBTRACT'
	base_weight_sub.location = (-1000, 800)
	base_weight_sub.inputs[0].default_value = 1.0
	links.new(alpha_sum_clamp.outputs[0], base_weight_sub.inputs[1])

	# calculate weighted layer percentages
	layer_pcts = []
	for i in range(8):
		# height modulation: height * height_scale + height_offset
		height_mult = nodes.new('ShaderNodeMath')
		height_mult.operation = 'MULTIPLY'
		height_mult.location = (-1600, 400 - i * 100)
		links.new(group_input.outputs[f'height_{i}'], height_mult.inputs[0])
		links.new(group_input.outputs[f'height_scale_{i}'], height_mult.inputs[1])

		height_add = nodes.new('ShaderNodeMath')
		height_add.operation = 'ADD'
		height_add.location = (-1400, 400 - i * 100)
		links.new(height_mult.outputs[0], height_add.inputs[0])
		links.new(group_input.outputs[f'height_offset_{i}'], height_add.inputs[1])

		# weight * height_modulated
		weight_mult = nodes.new('ShaderNodeMath')
		weight_mult.operation = 'MULTIPLY'
		weight_mult.location = (-1200, 400 - i * 100)

		if i == 0:
			links.new(base_weight_sub.outputs[0], weight_mult.inputs[0])
		else:
			links.new(group_input.outputs[f'alpha_{i}'], weight_mult.inputs[0])

		links.new(height_add.outputs[0], weight_mult.inputs[1])
		layer_pcts.append(weight_mult)

	# find maximum percentage
	max_nodes = []
	for i in range(len(layer_pcts) - 1):
		max_node = nodes.new('ShaderNodeMath')
		max_node.operation = 'MAXIMUM'
		max_node.location = (-900, 600 - i * 50)

		if i == 0:
			links.new(layer_pcts[0].outputs[0], max_node.inputs[0])
			links.new(layer_pcts[1].outputs[0], max_node.inputs[1])
		else:
			links.new(max_nodes[i-1].outputs[0], max_node.inputs[0])
			links.new(layer_pcts[i+1].outputs[0], max_node.inputs[1])

		max_nodes.append(max_node)

	# competitive suppression: pct * (1.0 - clamp(max_pct - pct, 0.0, 1.0))
	suppressed_pcts = []
	for i, pct_node in enumerate(layer_pcts):
		# max_pct - pct
		diff_sub = nodes.new('ShaderNodeMath')
		diff_sub.operation = 'SUBTRACT'
		diff_sub.location = (-600, 400 - i * 100)
		links.new(max_nodes[-1].outputs[0], diff_sub.inputs[0])
		links.new(pct_node.outputs[0], diff_sub.inputs[1])

		# clamp(diff, 0.0, 1.0)
		diff_clamp = nodes.new('ShaderNodeClamp')
		diff_clamp.location = (-400, 400 - i * 100)
		diff_clamp.inputs['Min'].default_value = 0.0
		diff_clamp.inputs['Max'].default_value = 1.0
		links.new(diff_sub.outputs[0], diff_clamp.inputs['Value'])

		# 1.0 - clamped_diff
		suppress_sub = nodes.new('ShaderNodeMath')
		suppress_sub.operation = 'SUBTRACT'
		suppress_sub.location = (-200, 400 - i * 100)
		suppress_sub.inputs[0].default_value = 1.0
		links.new(diff_clamp.outputs[0], suppress_sub.inputs[1])

		# pct * suppression_factor
		final_pct = nodes.new('ShaderNodeMath')
		final_pct.operation = 'MULTIPLY'
		final_pct.location = (0, 400 - i * 100)
		links.new(pct_node.outputs[0], final_pct.inputs[0])
		links.new(suppress_sub.outputs[0], final_pct.inputs[1])

		suppressed_pcts.append(final_pct)

	# calculate sum of suppressed percentages
	pct_sum_adds = []
	for i in range(len(suppressed_pcts) - 1):
		add_node = nodes.new('ShaderNodeMath')
		add_node.operation = 'ADD'
		add_node.location = (200, 600 - i * 50)

		if i == 0:
			links.new(suppressed_pcts[0].outputs[0], add_node.inputs[0])
			links.new(suppressed_pcts[1].outputs[0], add_node.inputs[1])
		else:
			links.new(pct_sum_adds[i-1].outputs[0], add_node.inputs[0])
			links.new(suppressed_pcts[i+1].outputs[0], add_node.inputs[1])

		pct_sum_adds.append(add_node)

	# normalize percentages
	normalized_pcts = []
	for i, pct_node in enumerate(suppressed_pcts):
		normalize_div = nodes.new('ShaderNodeMath')
		normalize_div.operation = 'DIVIDE'
		normalize_div.location = (400, 400 - i * 100)
		links.new(pct_node.outputs[0], normalize_div.inputs[0])
		links.new(pct_sum_adds[-1].outputs[0], normalize_div.inputs[1])
		normalized_pcts.append(normalize_div)

	# blend colors using normalized percentages (multiply each color by its weight)
	color_blends = []
	for i in range(8):  # process all 8 layers
		# separate RGB multiply node to multiply color by weight
		separate_rgb = nodes.new('ShaderNodeSeparateColor')
		separate_rgb.location = (400, 400 - i * 50)
		links.new(group_input.outputs[f'diffuse_{i}'], separate_rgb.inputs['Color'])

		# multiply each channel by the normalized percentage
		mult_r = nodes.new('ShaderNodeMath')
		mult_r.operation = 'MULTIPLY'
		mult_r.location = (550, 450 - i * 50)
		links.new(separate_rgb.outputs['Red'], mult_r.inputs[0])
		links.new(normalized_pcts[i].outputs[0], mult_r.inputs[1])

		mult_g = nodes.new('ShaderNodeMath')
		mult_g.operation = 'MULTIPLY'
		mult_g.location = (550, 400 - i * 50)
		links.new(separate_rgb.outputs['Green'], mult_g.inputs[0])
		links.new(normalized_pcts[i].outputs[0], mult_g.inputs[1])

		mult_b = nodes.new('ShaderNodeMath')
		mult_b.operation = 'MULTIPLY'
		mult_b.location = (550, 350 - i * 50)
		links.new(separate_rgb.outputs['Blue'], mult_b.inputs[0])
		links.new(normalized_pcts[i].outputs[0], mult_b.inputs[1])

		# combine back to color
		combine_rgb = nodes.new('ShaderNodeCombineColor')
		combine_rgb.location = (700, 400 - i * 50)
		links.new(mult_r.outputs[0], combine_rgb.inputs['Red'])
		links.new(mult_g.outputs[0], combine_rgb.inputs['Green'])
		links.new(mult_b.outputs[0], combine_rgb.inputs['Blue'])

		color_blends.append(combine_rgb)

	# sum all color contributions
	color_sum_adds = []
	for i in range(7):  # 7 add nodes for 8 colors
		add_node = nodes.new('ShaderNodeMixRGB' if not hasattr(bpy.types, 'ShaderNodeMix') else 'ShaderNodeMix')
		if hasattr(add_node, 'data_type'):
			add_node.data_type = 'RGBA'
		add_node.blend_type = 'ADD'
		add_node.location = (850, 600 - i * 50)

		if i == 0:
			# first add: color_0 + color_1
			links.new(color_blends[0].outputs[0], add_node.inputs['A'])
			links.new(color_blends[1].outputs[0], add_node.inputs['B'])
		else:
			# subsequent adds: previous_sum + color_(i+1)
			links.new(color_sum_adds[i-1].outputs['Result'], add_node.inputs['A'])
			links.new(color_blends[i+1].outputs[0], add_node.inputs['B'])

		# set factor to 1.0 for full addition
		add_node.inputs[0].default_value = 1.0

		color_sum_adds.append(add_node)

	# connect final result
	if len(color_sum_adds) > 0:
		links.new(color_sum_adds[-1].outputs['Result'], group_output.inputs['result'])
	else:
		# fallback: connect first color blend directly if no summation was done
		links.new(color_blends[0].outputs[0], group_output.inputs['result'])

	return group


def create_animated_texture_nodes(nodes, node_tree, animation_data, texture_path, x_pos, y_pos):
    """Create texture nodes with UV animation"""
    # Create TexturePanner node group instance
    panner_group = create_texture_panner_node_group()
    panner_node = nodes.new('ShaderNodeGroup')
    panner_node.node_tree = panner_group
    panner_node.location = (x_pos - 300, y_pos)
    
    # Set animation rates from processed data
    panner_node.inputs['Translate X Rate'].default_value = animation_data['translate_rate'][0]
    panner_node.inputs['Translate Y Rate'].default_value = animation_data['translate_rate'][1] 
    panner_node.inputs['Rotate Rate'].default_value = animation_data['rotate_rate']
    panner_node.inputs['Scale X Rate'].default_value = animation_data['scale_rate'][0]
    panner_node.inputs['Scale Y Rate'].default_value = animation_data['scale_rate'][1]
    
    # Create UV input node
    uv_node = nodes.new('ShaderNodeTexCoord')
    uv_node.location = (x_pos - 500, y_pos)
    
    # Create texture image node
    image_node = nodes.new('ShaderNodeTexImage')
    image_node.location = (x_pos, y_pos)
    image_node.image = loadImage(texture_path)
    image_node.image.alpha_mode = 'CHANNEL_PACKED'
    
    # Connect UV flow: UVCoord -> TexturePanner -> TextureImage
    node_tree.links.new(uv_node.outputs['UV'], panner_node.inputs['UV'])
    node_tree.links.new(panner_node.outputs['UV'], image_node.inputs['Vector'])
    
    return {
        'image_node': image_node,
        'panner_node': panner_node,
        'uv_node': uv_node
    }


def isTerrainFile(fileName):
    return fileName.startswith('adt_')


def detectTextureMode(materials):
    multiTilePattern = False

    for materialName in materials.keys():
        if not materialName.startswith('tex_'):
            continue

        parts = materialName.split('_')
        if len(parts) == 4:
            multiTilePattern = True
            break

    return 'EXTEND' if multiTilePattern else 'CLIP'


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
    
    # Generic water (type 1)
    if liquidType == 1:
        principled.inputs['Base Color'].default_value = (0.1, 0.3, 0.6, 1.0)
        principled.inputs['Alpha'].default_value = 0.8
        if IS_B40:
            principled.inputs['Transmission Weight'].default_value = 1.0
        else:
            principled.inputs['Transmission'].default_value = 1.0
    # Ocean (type 2)
    elif liquidType == 2:
        principled.inputs['Base Color'].default_value = (0.1, 0.4, 0.7, 1.0)
        principled.inputs['Alpha'].default_value = 0.85
        if IS_B40:
            principled.inputs['Transmission Weight'].default_value = 1.0
        else:
            principled.inputs['Transmission'].default_value = 1.0
    # Slime (type 3)
    elif liquidType == 3:
        principled.inputs['Base Color'].default_value = (0.3, 0.8, 0.2, 1.0)
        principled.inputs['Alpha'].default_value = 0.8
    # River (type 4)
    elif liquidType == 4:
        principled.inputs['Base Color'].default_value = (0.2, 0.5, 0.8, 1.0)
        principled.inputs['Alpha'].default_value = 0.7
        if IS_B40:
            principled.inputs['Transmission Weight'].default_value = 1.0
        else:
            principled.inputs['Transmission'].default_value = 1.0
    # Magma/lava (type 6)
    elif liquidType == 6:
        principled.inputs['Base Color'].default_value = (1.0, 0.3, 0.1, 1.0)
        principled.inputs['Alpha'].default_value = 0.9
        principled.inputs['Emission Strength' if IS_B40 else 'Emission'].default_value = 0.5
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

def createAdvancedM2Material(material_name, texture_unit, materials, textures, texture_combos, settings, base_dir, texture_transforms=None, texture_transforms_lookup=None):
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
    
    # Check for texture animation (only if UV animations are enabled)
    transform_combo_index = texture_unit.get('textureTransformComboIndex', -1)
    animation_data = None
    
    if settings.importUVAnimations:
        if (transform_combo_index not in {-1, 65535} and 
            texture_transforms_lookup and texture_transforms and
            transform_combo_index < len(texture_transforms_lookup)):
            
            transform_index = texture_transforms_lookup[transform_combo_index]
            
            if transform_index < len(texture_transforms):
                transform_data = texture_transforms[transform_index]
                animation_data = process_texture_transform(transform_data)
    
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
                if animation_data and i == 0:  # Only animate the first texture
                    # Create animated texture setup
                    animated_nodes = create_animated_texture_nodes(nodes, node_tree, animation_data, texture_path, tex_x_offset + i * 250, 200 - i * 200)
                    texture_nodes.append(animated_nodes['image_node'])
                else:
                    # Create static texture node
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
        texture_coords.location = (-2200, 0)

        # calculate required alpha map count - each image holds 4 layers (RGBA)
        alpha_layer_count = len(layers) - 1  # exclude base layer
        required_alpha_images = max(1, (alpha_layer_count + 3) // 4) if alpha_layer_count > 0 else 0

        alpha_maps = []
        alpha_map_channels = []

        for image_idx in range(required_alpha_images):
            alpha_map_frame = nodes.new(type='NodeFrame')
            alpha_map_frame.label = f'Alpha map {image_idx}'

            # generate filename based on naming convention
            if image_idx == 0:
                # first image uses original naming: tex_30_25_0.png
                alpha_map_path = textureLocation
            else:
                # additional images: _1, _2 etc
                base_path, ext = os.path.splitext(textureLocation)
                alpha_map_path = f'{base_path}_{image_idx}{ext}'

            alpha_map = nodes.new('ShaderNodeTexImage')
            alpha_map.location = (-1900, -100 - image_idx * 300)
            alpha_map.width = 140
            alpha_map.image = loadImage(alpha_map_path)
            alpha_map.image.colorspace_settings.name = 'Non-Color'
            alpha_map.interpolation = 'Cubic'
            alpha_map.extension = 'EXTEND'
            alpha_map.parent = alpha_map_frame

            channels = nodes.new('ShaderNodeSeparateColor')
            channels.location = (-1700, -100 - image_idx * 300)
            channels.width = 140
            channels.parent = alpha_map_frame

            node_tree.links.new(alpha_map.outputs['Color'], channels.inputs['Color'])
            node_tree.links.new(texture_coords.outputs['UV'], alpha_map.inputs['Vector'])

            alpha_maps.append(alpha_map)
            alpha_map_channels.append(channels)

        # create competitive blend node group instance
        competitive_blend_group = create_competitive_blend_node_group()
        competitive_blend_node = nodes.new('ShaderNodeGroup')
        competitive_blend_node.node_tree = competitive_blend_group
        competitive_blend_node.location = (0, 0)

        # prepare layer data arrays
        diffuse_textures = []
        height_textures = []
        alpha_values = []

        # setup layers for competitive blending
        for layer_idx, layer in enumerate(layers[:8]):  # limit to 8 layers for shader
            layer_frame = nodes.new(type='NodeFrame')
            layer_frame.label = f'Layer #{layer_idx}'

            # create texture mapping for this layer
            texture_mapping = nodes.new('ShaderNodeMapping')
            texture_mapping.location = (-2000, 500 - layer_idx * 150)
            texture_mapping.inputs[3].default_value[0] = 8 / layer['scale']
            texture_mapping.inputs[3].default_value[1] = 8 / layer['scale']
            texture_mapping.inputs[3].default_value[2] = 8 / layer['scale']
            texture_mapping.parent = layer_frame
            node_tree.links.new(texture_coords.outputs['UV'], texture_mapping.inputs['Vector'])

            # create diffuse texture
            diffuse_texture = nodes.new('ShaderNodeTexImage')
            diffuse_texture.location = (-1800, 500 - layer_idx * 150)
            diffuse_texture.image = loadImage(os.path.join(baseDir, layer['file']))
            diffuse_texture.image.alpha_mode = 'NONE'
            diffuse_texture.extension = 'REPEAT'
            diffuse_texture.parent = layer_frame
            node_tree.links.new(texture_mapping.outputs['Vector'], diffuse_texture.inputs['Vector'])
            diffuse_textures.append(diffuse_texture)

            # create height texture if available
            if 'heightFile' in layer:
                height_texture = nodes.new('ShaderNodeTexImage')
                height_texture.location = (-1600, 500 - layer_idx * 150)
                height_texture.image = loadImage(os.path.join(baseDir, layer['heightFile']))
                height_texture.image.colorspace_settings.name = 'Non-Color'
                height_texture.extension = 'REPEAT'
                height_texture.parent = layer_frame
                node_tree.links.new(texture_mapping.outputs['Vector'], height_texture.inputs['Vector'])
                height_textures.append(height_texture)
            else:
                # create a constant white value for missing height maps
                constant_value = nodes.new('ShaderNodeValue')
                constant_value.location = (-1600, 500 - layer_idx * 150)
                constant_value.outputs[0].default_value = 1.0
                constant_value.parent = layer_frame
                height_textures.append(constant_value)

            # extract alpha value for this layer
            if layer_idx == 0:
                # base layer alpha is calculated inside the competitive blend group
                alpha_constant = nodes.new('ShaderNodeValue')
                alpha_constant.location = (-1400, 500 - layer_idx * 150)
                alpha_constant.outputs[0].default_value = 1.0  # placeholder, actual calculation in group
                alpha_constant.parent = layer_frame
                alpha_values.append(alpha_constant)
            else:
                # calculate which alpha map image and channel this layer uses
                image_index = (layer_idx - 1) // 4
                channel_index = (layer_idx - 1) % 4

                if image_index < len(alpha_map_channels):
                    if channel_index == 3:
                        # alpha channel from image texture directly
                        alpha_values.append(alpha_maps[image_index])
                    else:
                        # RGB channels from separate color node
                        alpha_values.append(alpha_map_channels[image_index])
                else:
                    # no alpha data for this layer, use constant 0
                    alpha_constant = nodes.new('ShaderNodeValue')
                    alpha_constant.location = (-1400, 500 - layer_idx * 150)
                    alpha_constant.outputs[0].default_value = 0.0
                    alpha_constant.parent = layer_frame
                    alpha_values.append(alpha_constant)

        # connect all inputs to competitive blend node
        for i in range(min(8, len(layers))):
            layer = layers[i]

            # connect diffuse texture
            node_tree.links.new(
                diffuse_textures[i].outputs['Color'],
                competitive_blend_node.inputs[f'diffuse_{i}']
            )

            # connect height texture
            if hasattr(height_textures[i], 'type') and height_textures[i].type == 'TEX_IMAGE':
                # image texture node - use alpha channel for height
                node_tree.links.new(
                    height_textures[i].outputs['Alpha'],
                    competitive_blend_node.inputs[f'height_{i}']
                )
            else:
                # constant value node or any other node type
                node_tree.links.new(
                    height_textures[i].outputs[0],
                    competitive_blend_node.inputs[f'height_{i}']
                )

            # connect alpha value (skip alpha_0 since it doesn't exist as an input)
            if i > 0:
                image_index = (i - 1) // 4
                channel_index = (i - 1) % 4
                channel_names = ['Red', 'Green', 'Blue']

                if image_index < len(alpha_map_channels):
                    if channel_index == 3:
                        node_tree.links.new(
                            alpha_maps[image_index].outputs['Alpha'],
                            competitive_blend_node.inputs[f'alpha_{i}']
                        )
                    else:
                        node_tree.links.new(
                            alpha_map_channels[image_index].outputs[channel_names[channel_index]],
                            competitive_blend_node.inputs[f'alpha_{i}']
                        )
                else:
                    # no alpha data for this layer, set to 0
                    competitive_blend_node.inputs[f'alpha_{i}'].default_value = 0.0

            # set layer parameters from JSON
            competitive_blend_node.inputs[f'height_scale_{i}'].default_value = layer.get('heightScale', 0.0)
            competitive_blend_node.inputs[f'height_offset_{i}'].default_value = layer.get('heightOffset', 1.0)

        # connect competitive blend result to principled BSDF
        node_tree.links.new(
            competitive_blend_node.outputs['result'],
            principled.inputs['Base Color']
        )

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
                # Extract texture transform data for animation
                json_info['textureTransforms'] = json_info.get('textureTransforms', [])
                json_info['textureTransformsLookup'] = json_info.get('textureTransformsLookup', [])
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
                            json_texture_transforms = json_info.get('textureTransforms', [])
                            json_texture_transforms_lookup = json_info.get('textureTransformsLookup', [])
                            material = createAdvancedM2Material(materialName, texture_unit_found, json_materials, json_textures, json_texture_combos, settings, baseDir, json_texture_transforms, json_texture_transforms_lookup)
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
                                json_texture_transforms = json_info.get('textureTransforms', [])
                                json_texture_transforms_lookup = json_info.get('textureTransformsLookup', [])
                                materialB[bm] = (materialBName, createAdvancedM2Material(materialBName, texture_unit_found, json_materials, json_textures, json_texture_combos, settings, baseDir, json_texture_transforms, json_texture_transforms_lookup))
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
