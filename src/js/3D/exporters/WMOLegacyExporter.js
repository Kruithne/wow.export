/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const core = require('../../core');
const log = require('../../log');
const path = require('path');

const WMOLegacyLoader = require('../loaders/WMOLegacyLoader');
const ExportHelper = require('../../casc/export-helper');
const JSONWriter = require('../writers/JSONWriter');
const BufferWrapper = require('../../buffer');

class WMOLegacyExporter {
	constructor(data, filePath, mpq) {
		this.data = data;
		this.filePath = filePath;
		this.mpq = mpq;
		this.wmo = null;
	}

	async exportRaw(out, helper, fileManifest) {
		const config = core.view.config;
		const mpq = this.mpq;
		const outDir = path.dirname(out);

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('filePath', this.filePath);

		// write main wmo root file
		await this.data.writeToFile(out);
		fileManifest?.push({ type: 'WMO', file: out });

		log.write('Exported legacy WMO root: %s', out);

		// load wmo for parsing related files
		this.wmo = new WMOLegacyLoader(this.data, this.filePath, true);
		await this.wmo.load();

		// export textures
		if (config.modelsExportTextures) {
			const texturesManifest = [];
			const exportedTextures = new Set();

			const textureNames = this.wmo.textureNames || {};

			for (const texturePath of Object.values(textureNames)) {
				if (!texturePath || texturePath.length === 0)
					continue;

				// skip duplicates
				if (exportedTextures.has(texturePath.toLowerCase()))
					continue;

				exportedTextures.add(texturePath.toLowerCase());

				try {
					const textureData = mpq.getFile(texturePath);
					if (!textureData) {
						log.write('Texture not found in MPQ: %s', texturePath);
						continue;
					}

					let texOut;
					if (config.enableSharedTextures)
						texOut = ExportHelper.getExportPath(texturePath);
					else
						texOut = path.join(outDir, path.basename(texturePath));

					const buf = new BufferWrapper(Buffer.from(textureData));
					await buf.writeToFile(texOut);

					texturesManifest.push({ file: path.relative(outDir, texOut), path: texturePath });
					fileManifest?.push({ type: 'BLP', file: texOut });

					log.write('Exported legacy WMO texture: %s', texOut);
				} catch (e) {
					log.write('Failed to export WMO texture %s: %s', texturePath, e.message);
				}
			}

			manifest.addProperty('textures', texturesManifest);
		}

		// export wmo group files
		if (config.modelsExportWMOGroups && this.wmo.groupCount > 0) {
			const groupsManifest = [];

			for (let i = 0; i < this.wmo.groupCount; i++) {
				if (helper?.isCancelled?.())
					return;

				const groupFileName = this.filePath.replace('.wmo', '_' + i.toString().padStart(3, '0') + '.wmo');

				try {
					const groupData = mpq.getFile(groupFileName);
					if (!groupData) {
						log.write('WMO group file not found: %s', groupFileName);
						continue;
					}

					let groupOut;
					if (config.enableSharedChildren)
						groupOut = ExportHelper.getExportPath(groupFileName);
					else
						groupOut = path.join(outDir, path.basename(groupFileName));

					const buf = new BufferWrapper(Buffer.from(groupData));
					await buf.writeToFile(groupOut);

					groupsManifest.push({ file: path.relative(outDir, groupOut), path: groupFileName, index: i });
					fileManifest?.push({ type: 'WMO_GROUP', file: groupOut });

					log.write('Exported legacy WMO group: %s', groupOut);
				} catch (e) {
					log.write('Failed to export WMO group %s: %s', groupFileName, e.message);
				}
			}

			manifest.addProperty('groups', groupsManifest);
		}

		await manifest.write();
		fileManifest?.push({ type: 'MANIFEST', file: manifestFile });
	}
}

module.exports = WMOLegacyExporter;
