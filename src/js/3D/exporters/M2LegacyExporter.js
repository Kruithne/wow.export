/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const core = require('../../core');
const log = require('../../log');
const path = require('path');

const M2LegacyLoader = require('../loaders/M2LegacyLoader');
const ExportHelper = require('../../casc/export-helper');
const JSONWriter = require('../writers/JSONWriter');
const BufferWrapper = require('../../buffer');

class M2LegacyExporter {
	constructor(data, filePath, mpq) {
		this.data = data;
		this.filePath = filePath;
		this.mpq = mpq;
		this.m2 = null;
		this.skinTextures = null;
	}

	/**
	 * Set creature skin textures to export (replaceable textures)
	 * @param {string[]} textures - Array of texture file paths
	 */
	setSkinTextures(textures) {
		this.skinTextures = textures;
	}

	async exportRaw(out, helper, fileManifest) {
		const config = core.view.config;
		const mpq = this.mpq;
		const outDir = path.dirname(out);

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('filePath', this.filePath);

		// write main m2 file
		await this.data.writeToFile(out);
		fileManifest?.push({ type: 'M2', file: out });

		log.write('Exported legacy M2: %s', out);

		// export textures if enabled
		if (config.modelsExportTextures) {
			this.m2 = new M2LegacyLoader(this.data);
			await this.m2.load();

			const texturesManifest = [];
			const exportedTextures = new Set();

			// export embedded textures (type 0 with fileName)
			for (const texture of this.m2.textures) {
				if (!texture.fileName)
					continue;

				const texturePath = texture.fileName;

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

					texturesManifest.push({ file: path.relative(outDir, texOut), path: texturePath, type: 'embedded' });
					fileManifest?.push({ type: 'BLP', file: texOut });

					log.write('Exported legacy M2 texture: %s', texOut);
				} catch (e) {
					log.write('Failed to export texture %s: %s', texturePath, e.message);
				}
			}

			// export skin/variant textures (creature skins, etc)
			if (this.skinTextures && this.skinTextures.length > 0) {
				for (const texturePath of this.skinTextures) {
					if (!texturePath)
						continue;

					// skip duplicates
					if (exportedTextures.has(texturePath.toLowerCase()))
						continue;

					exportedTextures.add(texturePath.toLowerCase());

					try {
						const textureData = mpq.getFile(texturePath);
						if (!textureData) {
							log.write('Skin texture not found in MPQ: %s', texturePath);
							continue;
						}

						let texOut;
						if (config.enableSharedTextures)
							texOut = ExportHelper.getExportPath(texturePath);
						else
							texOut = path.join(outDir, path.basename(texturePath));

						const buf = new BufferWrapper(Buffer.from(textureData));
						await buf.writeToFile(texOut);

						texturesManifest.push({ file: path.relative(outDir, texOut), path: texturePath, type: 'skin' });
						fileManifest?.push({ type: 'BLP', file: texOut });

						log.write('Exported legacy M2 skin texture: %s', texOut);
					} catch (e) {
						log.write('Failed to export skin texture %s: %s', texturePath, e.message);
					}
				}
			}

			manifest.addProperty('textures', texturesManifest);
		}

		await manifest.write();
		fileManifest?.push({ type: 'MANIFEST', file: manifestFile });
	}
}

module.exports = M2LegacyExporter;
