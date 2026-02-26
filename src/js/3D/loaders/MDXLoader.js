/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const MAGIC_MDLX = 0x584C444D; // 'MDLX'

const NAME_LENGTH = 0x50;
const FILE_NAME_LENGTH = 0x104;

// mdx version range for alpha wow
const MDX_VER_MIN = 1300;
const MDX_VER_MAX = 1500;

// interpolation types
const INTERP_NONE = 0;
const INTERP_LINEAR = 1;
const INTERP_HERMITE = 2;
const INTERP_BEZIER = 3;

class MDXLoader {
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
	}

	async load() {
		if (this.isLoaded)
			return;

		const data = this.data;

		const magic = data.readUInt32LE();
		if (magic !== MAGIC_MDLX)
			throw new Error('Invalid MDX magic: 0x' + magic.toString(16));

		this._init_model();

		while (data.remainingBytes > 0) {
			const keyword = this._read_keyword();
			const size = data.readUInt32LE();
			const nextChunkPos = data.offset + size;

			const handler = MDXChunkHandlers[keyword];
			if (handler)
				handler.call(this, size);

			data.seek(nextChunkPos);
		}

		// assign pivot points to nodes
		for (let i = 0; i < this.nodes.length; i++) {
			if (this.nodes[i] && this.pivotPoints[this.nodes[i].objectId])
				this.nodes[i].pivotPoint = this.pivotPoints[this.nodes[i].objectId];
		}

		this.isLoaded = true;
	}

	_init_model() {
		this.version = 1300;
		this.info = {
			name: '',
			animationFile: '',
			minExtent: null,
			maxExtent: null,
			boundsRadius: 0,
			blendTime: 150,
			flags: 0
		};
		this.collision = {
			vertices: null,
			triIndices: null,
			facetNormals: null
		};
		this.sequences = [];
		this.globalSequences = [];
		this.textures = [];
		this.materials = [];
		this.textureAnims = [];
		this.geosets = [];
		this.geosetAnims = [];
		this.bones = [];
		this.helpers = [];
		this.attachments = [];
		this.eventObjects = [];
		this.particleEmitters = [];
		this.particleEmitters2 = [];
		this.cameras = [];
		this.lights = [];
		this.ribbonEmitters = [];
		this.hitTestShapes = [];
		this.pivotPoints = [];
		this.nodes = [];
	}

	_read_keyword() {
		const bytes = this.data.readUInt8(4);
		return String.fromCharCode(...bytes);
	}

	_expect_keyword(expected, error_msg) {
		const keyword = this._read_keyword();
		if (keyword !== expected)
			throw new Error(error_msg + ' (got ' + keyword + ')');
	}

	_read_string(length) {
		let str = '';
		for (let i = 0; i < length; i++) {
			const c = this.data.readUInt8();
			if (c !== 0)
				str += String.fromCharCode(c);
		}
		return str;
	}

	_read_extent(obj) {
		obj.boundsRadius = this.data.readFloatLE();
		obj.minExtent = this.data.readFloatLE(3);
		obj.maxExtent = this.data.readFloatLE(3);
	}

	_read_anim_vector(type) {
		const data = this.data;

		const count = data.readUInt32LE();
		const lineType = data.readUInt32LE();
		const globalSeqId = data.readInt32LE();

		const result = {
			lineType: lineType,
			globalSeqId: globalSeqId === -1 ? null : globalSeqId,
			keys: []
		};

		const readValue = () => {
			switch (type) {
				case 'float1':
					return data.readFloatLE();

				case 'float3':
					return data.readFloatLE(3);

				case 'float4':
					return data.readFloatLE(4);

				case 'int1':
					return data.readInt32LE();

				default:
					throw new Error('Unknown anim vector type: ' + type);
			}
		};

		for (let i = 0; i < count; i++) {
			const key = {
				frame: data.readInt32LE(),
				value: readValue(),
				inTan: null,
				outTan: null
			};

			if (lineType === INTERP_HERMITE || lineType === INTERP_BEZIER) {
				key.inTan = readValue();
				key.outTan = readValue();
			}

			result.keys.push(key);
		}

		return result;
	}

	_read_node(node) {
		const data = this.data;
		const startPos = data.offset;
		const size = data.readUInt32LE();

		node.name = this._read_string(NAME_LENGTH);
		node.objectId = data.readInt32LE();
		node.parent = data.readInt32LE();
		node.flags = data.readUInt32LE();

		if (node.objectId === -1)
			node.objectId = null;
		if (node.parent === -1)
			node.parent = null;

		while (data.offset < startPos + size) {
			const keyword = this._read_keyword();
			switch (keyword) {
				case 'KGTR':
					node.translation = this._read_anim_vector('float3');
					break;
				case 'KGRT':
					node.rotation = this._read_anim_vector('float4');
					break;
				case 'KGSC':
					node.scale = this._read_anim_vector('float3');
					break;
				default:
					throw new Error('Unknown node chunk: ' + keyword);
			}
		}

		if (node.objectId !== null)
			this.nodes[node.objectId] = node;
	}
}

const MDXChunkHandlers = {
	VERS: function() {
		this.version = this.data.readUInt32LE();
		if (this.version < MDX_VER_MIN || this.version > MDX_VER_MAX)
			throw new Error('Unsupported MDX version: ' + this.version);
	},

	MODL: function() {
		this.info.name = this._read_string(NAME_LENGTH);
		this.info.animationFile = this._read_string(FILE_NAME_LENGTH);
		this._read_extent(this.info);
		this.info.blendTime = this.data.readUInt32LE();
		this.info.flags = this.data.readUInt8();
	},

	SEQS: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const seq = {
				name: this._read_string(NAME_LENGTH),
				interval: [this.data.readUInt32LE(), this.data.readUInt32LE()],
				moveSpeed: this.data.readFloatLE(),
				nonLooping: this.data.readInt32LE() > 0
			};
			this._read_extent(seq);
			seq.frequency = this.data.readFloatLE();
			seq.replay = [this.data.readUInt32LE(), this.data.readUInt32LE()];
			seq.blendTime = this.data.readInt32LE();

			this.sequences.push(seq);
		}
	},

	GLBS: function(size) {
		const count = size / 4;
		for (let i = 0; i < count; i++)
			this.globalSequences.push(this.data.readUInt32LE());
	},

	MTLS: function() {
		const count = this.data.readUInt32LE();
		this.data.readUInt32LE(); // unused

		for (let i = 0; i < count; i++) {
			const material = { layers: [] };

			this.data.readUInt32LE(); // material size
			material.priorityPlane = this.data.readInt32LE();

			const layerCount = this.data.readUInt32LE();

			for (let j = 0; j < layerCount; j++) {
				const startPos = this.data.offset;
				const layerSize = this.data.readUInt32LE();

				const layer = {
					filterMode: this.data.readInt32LE(),
					shading: this.data.readInt32LE(),
					textureId: this.data.readInt32LE(),
					tVertexAnimId: this.data.readInt32LE(),
					coordId: this.data.readInt32LE(),
					alpha: this.data.readFloatLE()
				};

				if (layer.tVertexAnimId === -1)
					layer.tVertexAnimId = null;

				while (this.data.offset < startPos + layerSize) {
					const keyword = this._read_keyword();
					switch (keyword) {
						case 'KMTA':
							layer.alphaAnim = this._read_anim_vector('float1');
							break;
						case 'KMTF':
							layer.textureIdAnim = this._read_anim_vector('int1');
							break;
						default:
							throw new Error('Unknown layer chunk: ' + keyword);
					}
				}

				material.layers.push(layer);
			}

			this.materials.push(material);
		}
	},

	TEXS: function(size) {
		const startPos = this.data.offset;

		while (this.data.offset < startPos + size) {
			const texture = {
				replaceableId: this.data.readInt32LE(),
				image: this._read_string(FILE_NAME_LENGTH),
				flags: this.data.readInt32LE()
			};

			this.textures.push(texture);
		}
	},

	GEOS: function() {
		if (this.version === 1500)
			this._parse_geosets_v1500();
		else
			this._parse_geosets_v1300();
	},

	GEOA: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const startPos = this.data.offset;
			const size = this.data.readUInt32LE();

			const anim = {
				geosetId: this.data.readInt32LE(),
				alpha: this.data.readFloatLE(),
				color: this.data.readFloatLE(3),
				flags: this.data.readInt32LE()
			};

			if (anim.geosetId === -1)
				anim.geosetId = null;

			while (this.data.offset < startPos + size) {
				const keyword = this._read_keyword();
				switch (keyword) {
					case 'KGAO':
						anim.alphaAnim = this._read_anim_vector('float1');
						break;
					case 'KGAC':
						anim.colorAnim = this._read_anim_vector('float3');
						break;
					default:
						throw new Error('Unknown geoset anim chunk: ' + keyword);
				}
			}

			this.geosetAnims.push(anim);
		}
	},

	BONE: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const bone = {};
			this._read_node(bone);

			bone.geosetId = this.data.readInt32LE();
			bone.geosetAnimId = this.data.readInt32LE();

			if (bone.geosetId === -1)
				bone.geosetId = null;
			if (bone.geosetAnimId === -1)
				bone.geosetAnimId = null;

			this.bones.push(bone);
		}
	},

	HELP: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const helper = {};
			this._read_node(helper);
			this.helpers.push(helper);
		}
	},

	ATCH: function() {
		const count = this.data.readUInt32LE();
		this.data.readUInt32LE(); // unused

		for (let i = 0; i < count; i++) {
			const startPos = this.data.offset;
			this.data.readUInt32LE(); // size

			const attachment = {};
			this._read_node(attachment);

			attachment.attachmentId = this.data.readInt32LE();
			this.data.readUInt8(); // padding
			attachment.path = this._read_string(FILE_NAME_LENGTH);
			attachment.visibility = 1;

			// check for KVIS
			if (this.data.offset < startPos + this.data.readUInt32LE(-4)) {
				const keyword = this._read_keyword();
				if (keyword === 'KVIS')
					attachment.visibilityAnim = this._read_anim_vector('float1');
			}

			this.attachments.push(attachment);
		}
	},

	PIVT: function(size) {
		const count = size / 12;
		for (let i = 0; i < count; i++)
			this.pivotPoints[i] = this.data.readFloatLE(3);
	},

	EVTS: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			this.data.readUInt32LE(); // size

			const event = {};
			this._read_node(event);

			// check for KEVT
			const keyword = this._read_keyword();
			if (keyword === 'KEVT') {
				const trackCount = this.data.readUInt32LE();
				event.globalSeqId = this.data.readInt32LE();
				event.eventTrack = [];
				for (let j = 0; j < trackCount; j++)
					event.eventTrack.push(this.data.readInt32LE());
			}

			this.eventObjects.push(event);
		}
	},

	HTST: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			this.data.readUInt32LE(); // size

			const shape = {};
			this._read_node(shape);

			shape.shapeType = this.data.readUInt8();

			switch (shape.shapeType) {
				case 0: // box
					shape.vertices = this.data.readFloatLE(6);
					break;
				case 1: // cylinder
					shape.vertices = this.data.readFloatLE(5);
					break;
				case 2: // sphere
					shape.vertices = this.data.readFloatLE(4);
					break;
				case 3: // plane
					shape.vertices = this.data.readFloatLE(2);
					break;
			}

			this.hitTestShapes.push(shape);
		}
	},

	CLID: function() {
		this._expect_keyword('VRTX', 'Invalid collision format');
		this.collision.vertices = this.data.readFloatLE(this.data.readUInt32LE() * 3);

		this._expect_keyword('TRI ', 'Invalid collision format');
		this.collision.triIndices = this.data.readUInt16LE(this.data.readUInt32LE());

		this._expect_keyword('NRMS', 'Invalid collision format');
		this.collision.facetNormals = this.data.readFloatLE(this.data.readUInt32LE() * 3);
	},

	PREM: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const startPos = this.data.offset;
			const size = this.data.readUInt32LE();

			const emitter = {};
			this._read_node(emitter);

			emitter.emissionRate = this.data.readFloatLE();
			emitter.gravity = this.data.readFloatLE();
			emitter.longitude = this.data.readFloatLE();
			emitter.latitude = this.data.readFloatLE();
			emitter.path = this._read_string(FILE_NAME_LENGTH);
			emitter.lifeSpan = this.data.readFloatLE();
			emitter.initVelocity = this.data.readFloatLE();
			emitter.visibility = 1;

			while (this.data.offset < startPos + size) {
				const keyword = this._read_keyword();
				switch (keyword) {
					case 'KVIS': emitter.visibilityAnim = this._read_anim_vector('float1'); break;
					case 'KPEE': emitter.emissionRateAnim = this._read_anim_vector('float1'); break;
					case 'KPEG': emitter.gravityAnim = this._read_anim_vector('float1'); break;
					case 'KPLN': emitter.longitudeAnim = this._read_anim_vector('float1'); break;
					case 'KPLT': emitter.latitudeAnim = this._read_anim_vector('float1'); break;
					case 'KPEL': emitter.lifeSpanAnim = this._read_anim_vector('float1'); break;
					case 'KPES': emitter.initVelocityAnim = this._read_anim_vector('float1'); break;
					default:
						throw new Error('Unknown particle emitter chunk: ' + keyword);
				}
			}

			this.particleEmitters.push(emitter);
		}
	},

	PRE2: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const startPos = this.data.offset;
			const size = this.data.readUInt32LE();

			const emitter = {};
			this._read_node(emitter);

			this.data.readUInt32LE(); // content size
			emitter.emitterType = this.data.readInt32LE();
			emitter.speed = this.data.readFloatLE();
			emitter.variation = this.data.readFloatLE();
			emitter.latitude = this.data.readFloatLE();
			emitter.longitude = this.data.readFloatLE();
			emitter.gravity = this.data.readFloatLE();
			emitter.zSource = this.data.readFloatLE();
			emitter.lifeSpan = this.data.readFloatLE();
			emitter.emissionRate = this.data.readFloatLE();
			emitter.length = this.data.readFloatLE();
			emitter.width = this.data.readFloatLE();
			emitter.rows = this.data.readInt32LE();
			emitter.columns = this.data.readInt32LE();
			emitter.particleType = this.data.readInt32LE() + 1;
			emitter.tailLength = this.data.readFloatLE();
			emitter.middleTime = this.data.readFloatLE();
			emitter.segmentColor = [
				this.data.readFloatLE(3),
				this.data.readFloatLE(3),
				this.data.readFloatLE(3)
			];
			emitter.alpha = this.data.readUInt8(3);
			emitter.particleScaling = this.data.readFloatLE(3);
			emitter.lifeSpanUVAnim = this.data.readFloatLE(3);
			emitter.decayUVAnim = this.data.readFloatLE(3);
			emitter.tailUVAnim = this.data.readFloatLE(3);
			emitter.tailDecayUVAnim = this.data.readFloatLE(3);
			emitter.blendMode = this.data.readInt32LE();
			emitter.textureId = this.data.readInt32LE();
			emitter.priorityPlane = this.data.readInt32LE();
			emitter.replaceableId = this.data.readInt32LE();
			emitter.geometryModel = this._read_string(FILE_NAME_LENGTH);
			emitter.recursionModel = this._read_string(FILE_NAME_LENGTH);
			emitter.twinkleFps = this.data.readFloatLE();
			emitter.twinkleOnOff = this.data.readFloatLE();
			emitter.twinkleScale = this.data.readFloatLE(2);
			emitter.ivelScale = this.data.readFloatLE();
			emitter.tumble = this.data.readFloatLE(6);
			emitter.drag = this.data.readFloatLE();
			emitter.spin = this.data.readFloatLE();
			emitter.windVector = this.data.readFloatLE(3);
			emitter.windTime = this.data.readFloatLE();
			emitter.followSpeed = this.data.readFloatLE(2);
			emitter.followScale = this.data.readFloatLE(2);

			const splineCount = this.data.readUInt32LE();
			emitter.splines = [];
			for (let j = 0; j < splineCount; j++)
				emitter.splines.push(this.data.readFloatLE(3));

			emitter.squirt = this.data.readInt32LE() > 0;
			emitter.visibility = 1;

			if (emitter.textureId === -1)
				emitter.textureId = null;

			while (this.data.offset < startPos + size) {
				const keyword = this._read_keyword();
				switch (keyword) {
					case 'KP2S': emitter.speedAnim = this._read_anim_vector('float1'); break;
					case 'KP2R': emitter.variationAnim = this._read_anim_vector('float1'); break;
					case 'KP2G': emitter.gravityAnim = this._read_anim_vector('float1'); break;
					case 'KP2W': emitter.widthAnim = this._read_anim_vector('float1'); break;
					case 'KP2N': emitter.lengthAnim = this._read_anim_vector('float1'); break;
					case 'KVIS': emitter.visibilityAnim = this._read_anim_vector('float1'); break;
					case 'KP2E': emitter.emissionRateAnim = this._read_anim_vector('float1'); break;
					case 'KP2L': emitter.latitudeAnim = this._read_anim_vector('float1'); break;
					case 'KPLN': emitter.longitudeAnim = this._read_anim_vector('float1'); break;
					case 'KLIF': emitter.lifeSpanAnim = this._read_anim_vector('float1'); break;
					case 'KP2Z': emitter.zSourceAnim = this._read_anim_vector('float1'); break;
					default:
						throw new Error('Unknown particle emitter2 chunk: ' + keyword);
				}
			}

			this.particleEmitters2.push(emitter);
		}
	},

	CAMS: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const startPos = this.data.offset;
			const size = this.data.readUInt32LE();

			const camera = {
				name: this._read_string(NAME_LENGTH),
				pivot: this.data.readFloatLE(3),
				fieldOfView: this.data.readFloatLE(),
				farClip: this.data.readFloatLE(),
				nearClip: this.data.readFloatLE(),
				targetPosition: this.data.readFloatLE(3),
				visibility: 1
			};

			while (this.data.offset < startPos + size) {
				const keyword = this._read_keyword();
				switch (keyword) {
					case 'KVIS': camera.visibilityAnim = this._read_anim_vector('float1'); break;
					case 'KCTR': camera.translation = this._read_anim_vector('float3'); break;
					case 'KTTR': camera.targetTranslation = this._read_anim_vector('float3'); break;
					case 'KCRL': camera.rotationAnim = this._read_anim_vector('float1'); break;
					default:
						throw new Error('Unknown camera chunk: ' + keyword);
				}
			}

			this.cameras.push(camera);
		}
	},

	LITE: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const startPos = this.data.offset;
			const size = this.data.readUInt32LE();

			const light = {};
			this._read_node(light);

			light.lightType = this.data.readInt32LE();
			light.attenuationStart = this.data.readFloatLE();
			light.attenuationEnd = this.data.readFloatLE();
			light.color = this.data.readFloatLE(3);
			light.intensity = this.data.readFloatLE();
			light.ambColor = this.data.readFloatLE(3);
			light.ambIntensity = this.data.readFloatLE();
			light.visibility = 1;

			while (this.data.offset < startPos + size) {
				const keyword = this._read_keyword();
				switch (keyword) {
					case 'KLAS': light.attenuationStartAnim = this._read_anim_vector('int1'); break;
					case 'KLAE': light.attenuationEndAnim = this._read_anim_vector('int1'); break;
					case 'KLAC': light.colorAnim = this._read_anim_vector('float3'); break;
					case 'KLAI': light.intensityAnim = this._read_anim_vector('float1'); break;
					case 'KLBC': light.ambColorAnim = this._read_anim_vector('float3'); break;
					case 'KLBI': light.ambIntensityAnim = this._read_anim_vector('float1'); break;
					case 'KVIS': light.visibilityAnim = this._read_anim_vector('float1'); break;
					default:
						throw new Error('Unknown light chunk: ' + keyword);
				}
			}

			this.lights.push(light);
		}
	},

	TXAN: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const startPos = this.data.offset;
			const size = this.data.readUInt32LE();

			const anim = {};

			while (this.data.offset < startPos + size) {
				const keyword = this._read_keyword();
				switch (keyword) {
					case 'KTAT': anim.translation = this._read_anim_vector('float3'); break;
					case 'KTAR': anim.rotation = this._read_anim_vector('float4'); break;
					case 'KTAS': anim.scale = this._read_anim_vector('float3'); break;
					default:
						throw new Error('Unknown texture anim chunk: ' + keyword);
				}
			}

			this.textureAnims.push(anim);
		}
	},

	RIBB: function() {
		const count = this.data.readUInt32LE();

		for (let i = 0; i < count; i++) {
			const startPos = this.data.offset;
			const size = this.data.readUInt32LE();

			const emitter = {};
			this._read_node(emitter);

			this.data.readUInt32LE(); // content size
			emitter.heightAbove = this.data.readFloatLE();
			emitter.heightBelow = this.data.readFloatLE();
			emitter.alpha = this.data.readFloatLE();
			emitter.color = this.data.readFloatLE(3);
			emitter.lifeSpan = this.data.readFloatLE();
			emitter.textureSlot = this.data.readInt32LE();
			emitter.edgesPerSec = this.data.readInt32LE();
			emitter.rows = this.data.readInt32LE();
			emitter.columns = this.data.readInt32LE();
			emitter.materialId = this.data.readInt32LE();
			emitter.gravity = this.data.readFloatLE();
			emitter.visibility = 1;

			while (this.data.offset < startPos + size) {
				const keyword = this._read_keyword();
				switch (keyword) {
					case 'KVIS': emitter.visibilityAnim = this._read_anim_vector('float1'); break;
					case 'KRHA': emitter.heightAboveAnim = this._read_anim_vector('float1'); break;
					case 'KRHB': emitter.heightBelowAnim = this._read_anim_vector('float1'); break;
					case 'KRAL': emitter.alphaAnim = this._read_anim_vector('float1'); break;
					case 'KRTX': emitter.textureSlotAnim = this._read_anim_vector('int1'); break;
					case 'KRCO': emitter.colorAnim = this._read_anim_vector('float3'); break;
					default:
						throw new Error('Unknown ribbon emitter chunk: ' + keyword);
				}
			}

			this.ribbonEmitters.push(emitter);
		}
	}
};

// geoset parsing
MDXLoader.prototype._parse_geosets_v1300 = function() {
	const count = this.data.readUInt32LE();

	for (let i = 0; i < count; i++) {
		const geoset = {
			tVertices: [],
			groups: [],
			anims: []
		};

		this.data.readUInt32LE(); // geoset size

		this._expect_keyword('VRTX', 'Invalid geoset format');
		geoset.vertices = this.data.readFloatLE(this.data.readUInt32LE() * 3);

		this._expect_keyword('NRMS', 'Invalid geoset format');
		geoset.normals = this.data.readFloatLE(this.data.readUInt32LE() * 3);

		// check for UVAS
		const keyword = this._read_keyword();
		if (keyword === 'UVAS') {
			const texChunkCount = this.data.readUInt32LE();
			const vertCount = geoset.vertices.length / 3;
			for (let j = 0; j < texChunkCount; j++)
				geoset.tVertices.push(this.data.readFloatLE(vertCount * 2));
		} else {
			this.data.move(-4);
		}

		this._expect_keyword('PTYP', 'Invalid geoset format');
		const primCount = this.data.readUInt32LE();
		for (let j = 0; j < primCount; j++) {
			if (this.data.readUInt8() !== 4)
				throw new Error('Invalid primitive type');
		}

		this._expect_keyword('PCNT', 'Invalid geoset format');
		this.data.move(this.data.readUInt32LE() * 4); // faceGroups

		this._expect_keyword('PVTX', 'Invalid geoset format');
		geoset.faces = this.data.readUInt16LE(this.data.readUInt32LE());

		this._expect_keyword('GNDX', 'Invalid geoset format');
		geoset.vertexGroup = this.data.readUInt8(this.data.readUInt32LE());

		this._expect_keyword('MTGC', 'Invalid geoset format');
		const groupCount = this.data.readUInt32LE();
		for (let j = 0; j < groupCount; j++)
			geoset.groups[j] = new Array(this.data.readUInt32LE());

		this._expect_keyword('MATS', 'Invalid geoset format');
		const totalGroupCount = this.data.readUInt32LE();
		let groupIndex = 0, groupCounter = 0;
		for (let j = 0; j < totalGroupCount; j++) {
			if (groupIndex >= geoset.groups[groupCounter].length) {
				groupIndex = 0;
				groupCounter++;
			}
			geoset.groups[groupCounter][groupIndex++] = this.data.readInt32LE();
		}

		this._expect_keyword('BIDX', 'Invalid geoset format');
		this.data.move(this.data.readUInt32LE() * 4); // bone indices

		this._expect_keyword('BWGT', 'Invalid geoset format');
		this.data.move(this.data.readUInt32LE() * 4); // bone weights

		geoset.materialId = this.data.readInt32LE();
		geoset.selectionGroup = this.data.readInt32LE();
		geoset.flags = this.data.readInt32LE();
		this._read_extent(geoset);

		const animCount = this.data.readUInt32LE();
		for (let j = 0; j < animCount; j++) {
			const anim = {};
			this._read_extent(anim);
			geoset.anims.push(anim);
		}

		this.geosets.push(geoset);
	}
};

MDXLoader.prototype._parse_geosets_v1500 = function() {
	const count = this.data.readUInt32LE();

	for (let i = 0; i < count; i++) {
		const geoset = {
			tVertices: [],
			groups: [],
			anims: []
		};

		geoset.materialId = this.data.readInt32LE();
		this.data.readFloatLE(3); // bounds center
		geoset.boundsRadius = this.data.readFloatLE();
		geoset.selectionGroup = this.data.readInt32LE();
		this.data.readInt32LE(); // geoset index
		geoset.flags = this.data.readInt32LE();

		this._expect_keyword('PVTX', 'Invalid geoset format');
		const vertexCount = this.data.readUInt32LE();
		this._expect_keyword('PTYP', 'Invalid geoset format');
		this.data.readInt32LE(); // primitive type count
		this._expect_keyword('PVTX', 'Invalid geoset format');
		this.data.readInt32LE(); // primitive vertex count
		this.data.move(8); // padding

		geoset.vertices = new Float32Array(vertexCount * 3);
		geoset.normals = new Float32Array(vertexCount * 3);
		geoset.vertexGroup = new Uint8Array(vertexCount);
		geoset.tVertices = [new Float32Array(vertexCount * 2)];

		this.geosets.push(geoset);
	}

	// vertex data
	for (let i = 0; i < count; i++) {
		const geoset = this.geosets[i];
		const vertexCount = geoset.vertices.length / 3;
		const boneLookup = [];

		for (let j = 0; j < vertexCount; j++) {
			const pos = this.data.readFloatLE(3);
			geoset.vertices[j * 3] = pos[0];
			geoset.vertices[j * 3 + 1] = pos[1];
			geoset.vertices[j * 3 + 2] = pos[2];

			this.data.readUInt32LE(); // bone weights
			const boneIndices = this.data.readUInt8(4).join(',');

			const normal = this.data.readFloatLE(3);
			geoset.normals[j * 3] = normal[0];
			geoset.normals[j * 3 + 1] = normal[1];
			geoset.normals[j * 3 + 2] = normal[2];

			const uv = this.data.readFloatLE(2);
			geoset.tVertices[0][j * 2] = uv[0];
			geoset.tVertices[0][j * 2 + 1] = uv[1];
			this.data.move(8); // unused

			let idx = boneLookup.indexOf(boneIndices);
			if (idx === -1) {
				idx = boneLookup.length;
				boneLookup.push(boneIndices);
			}
			geoset.vertexGroup[j] = idx;
		}

		geoset.groups = boneLookup.map(b => b.replace(/(,0)+$/, '').split(',').map(Number));

		this.data.readInt32LE(); // primitive type
		this.data.readInt32LE(); // unknown

		const numPrimVerts = this.data.readUInt16LE();
		this.data.readUInt16LE(); // min vertex
		this.data.readUInt16LE(); // max vertex
		this.data.readUInt16LE(); // padding

		geoset.faces = this.data.readUInt16LE(numPrimVerts);

		if (numPrimVerts % 8)
			this.data.move(2 * (8 - numPrimVerts % 8)); // padding
	}
};

export default MDXLoader;