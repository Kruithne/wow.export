const core = require('../core');
const log = require('../log');
const util = require('util');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const constants = require('../constants');
const M2Loader = require('../3D/loaders/M2Loader');
const BLPFile = require('../casc/blp');
const Texture = require('../3D/Texture');

let isLoading = false;
let selectedFile = null;
let userSelection = [];

let camera, scene;
let loadedM2, loadedModel;

const previewModel = async (fileName) => {
	isLoading = true;
	const toast = core.delayToast(200, 'progress', util.format('Loading %s, please wait...', fileName), null, -1, false);
	log.write('Previewing model %s', fileName);

	try {
		// Dispose of existing model.
		if (loadedModel) {
			scene.remove(loadedModel);
			loadedModel.geometry.dispose();
		}

		const file = await core.view.casc.getFileByName(fileName);
		if (fileName.toLowerCase().endsWith('.m2')) {

			loadedM2 = new M2Loader(file);
			await loadedM2.load();

			console.log(loadedM2);

			// Don't try to load a model without veritices.
			if (loadedM2.vertices.length > 0) {
				const skin = await loadedM2.getSkin(0);
				const materials = new Array(loadedM2.textures.length);

				for (let i = 0, n = loadedM2.textures.length; i < n; i++) {
					const texture = loadedM2.textures[i];

					if (texture.fileDataID > 0) {
						const data = await texture.getTextureFile();
						const blp = new BLPFile(data);

						const tex = new THREE.TextureLoader().load(await blp.getDataURL());
						if (texture.flags & Texture.FLAG_WRAP_U)
							tex.wrapS = THREE.RepeatWrapping;

						if (texture.flags & Texture.FLAG_WRAP_V)
							tex.wrapT = THREE.RepeatWrapping;

						const mat = new THREE.MeshPhongMaterial({ map: tex });

						materials[i] = mat;
					}

					//const mat = new THREE.TextureLoader().load(data.getDataURL());
				}

				const geometry = new THREE.BufferGeometry();
				geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(loadedM2.vertices), 3));
				geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(loadedM2.normals), 3));
				geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(loadedM2.uv), 2));
				geometry.setIndex(skin.triangles);

				for (let i = 0, n = skin.submeshes.length; i < n; i++) {
					const mesh = skin.submeshes[i];
					const texUnit = skin.textureUnits.find(tex => tex.submeshIndex === i);
					geometry.addGroup(mesh.triangleStart, mesh.triangleCount, texUnit.texture);
				}

				loadedModel = new THREE.Mesh(geometry, materials);
				scene.add(loadedModel);

				// Adjust for weird WoW rotations?
				loadedModel.rotateOnAxis(new THREE.Vector3(1, 0, 0), 270 * (Math.PI / 180));
				loadedModel.rotateOnAxis(new THREE.Vector3(0, 0, 1), 270 * (Math.PI / 180));

				// Get the bounding box for the model.
				const boundingBox = new THREE.Box3();
				boundingBox.setFromObject(loadedModel);

				// Calculate center point and size from bounding box.
				const center = boundingBox.getCenter(new THREE.Vector3());
				const size = boundingBox.getSize(new THREE.Vector3());

				const maxDim = Math.max(size.x, size.y, size.z);
				const fov = camera.fov * (Math.PI / 180);
				let cameraZ = (Math.abs(maxDim / 4 * Math.tan(fov * 2))) * 6;
				camera.position.set(center.x, center.y, cameraZ);

				const minZ = boundingBox.min.z;
				const cameraToFarEdge = (minZ < 0) ? -minZ + cameraZ : cameraZ - minZ;

				camera.far = cameraToFarEdge * 3;
				camera.updateProjectionMatrix();

				const controls = core.view.modelViewerContext.controls;
				if (controls) {
					controls.target = center;
					controls.maxDistance = cameraToFarEdge * 2;
				}
			}
		}

		selectedFile = fileName;
		toast.cancel();
	} catch (e) {
		toast.cancel();
		core.setToast('error', 'Unable to open file: ' + fileName, { 'View Log': () => log.openRuntimeLog() });
		log.write('Failed to open CASC file: %s', e.message);
	}

	isLoading = false;
};

const exportFiles = async (files, isLocal = false) => {
	const helper = new ExportHelper(files.length, 'model');
	helper.start();

	const format = core.view.config.exportModelFormat;
	for (const fileName of files) {
		try {
			const data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFileByName(fileName));
			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);

			if (format === 'M2/WMO') {
				// Export as raw file with no conversion.
				await data.writeToFile(exportPath);
			} else {
				// ToDo: M2/WMO conversion.
			}

			helper.mark(fileName, true);
		} catch (e) {
			helper.mark(fileName, false, e.message);
		}
	}

	helper.finish();
};

/**
 * Update the 3D model listfile.
 * Invoke when users change the visibility settings for model types.
 */
const updateListfile = () => {
	// Filters for the model viewer depending on user settings.
	const modelExt = [];
	if (core.view.config.modelsShowM2)
		modelExt.push('.m2');
	
	if (core.view.config.modelsShowWMO)
		modelExt.push(['.wmo', constants.LISTFILE_MODEL_FILTER]);

	// Create a new listfile using the given configuration.
	core.view.listfileModels = listfile.getFilenamesByExtension(modelExt);
};

const onRender = () => {

	
	requestAnimationFrame(onRender);
};

// Register a drop handler for M2/WMO files.
core.registerDropHandler({
	ext: ['.m2', '.wmo'],
	prompt: count => util.format('Export %d models as %s', count, core.view.config.exportModelFormat),
	process: files => exportFiles(files, true)
});

// The first time the user opens up the model tab, initialize 3D preview.
core.events.once('screen-tab-models', () => {
	camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.01, 10);

	scene = new THREE.Scene();
	const light = new THREE.HemisphereLight(0xffffbb, 0x080820, 1);
	scene.add(light);

	core.view.modelViewerContext = { camera, scene };
	onRender();
});

core.events.once('init', () => {
	// Track changes to the visible model listfile types.
	core.view.$watch('config.modelsShowM2', updateListfile);
	core.view.$watch('config.modelsShowWMO', updateListfile);

	// Track selection changes on the model listbox and preview first model.
	core.events.on('user-select-model', async selection => {
		// Store the full selection for exporting purposes.
		userSelection = selection;

		// Check if the first file in the selection is "new".
		const first = selection[0];
		if (!isLoading && first && selectedFile !== first)
			previewModel(first);
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-model', async () => {
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		await exportFiles(userSelection, false);
	});
});