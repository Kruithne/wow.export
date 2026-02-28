/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import core from '../core.js';
import * as platform from '../platform.js';
import log from '../log.js';
import generics from '../generics.js';
import { listfile } from '../../views/main/rpc.js';
import ExportHelper from '../export-helper.js';
import BLPFile from '../casc/blp.js';
import BufferWrapper from '../buffer.js';
import JSONWriter from '../3D/writers/JSONWriter.js';

/**
 * Retrieve the fileDataID and fileName for a given fileDataID or fileName.
 * @param {number|string} input
 * @returns {object}
 */
const getFileInfoPair = async (input) => {
	let fileName;
	let fileDataID;

	if (typeof input === 'number') {
		fileDataID = input;
		fileName = (await listfile.getByID(fileDataID)) ?? listfile.formatUnknownFile(fileDataID, '.blp');
	} else {
		fileName = listfile.stripFileEntry(input);
		fileDataID = await listfile.getByFilename(fileName);
	}

	return { fileName, fileDataID };
};

/**
 * Export BLP metadata to a JSON file.
 * @param {BLPFile} blp - The BLP file instance
 * @param {string} exportPath - The export path of the image file
 * @param {boolean} overwriteFiles - Whether to overwrite existing files
 * @param {object} manifest - The export manifest object
 * @param {number} fileDataID - The file data ID
 */
const exportBLPMetadata = async (blp, exportPath, overwriteFiles, manifest, fileDataID) => {
	const jsonOut = ExportHelper.replaceExtension(exportPath, '.json');
	const json = new JSONWriter(jsonOut);
	json.addProperty('encoding', blp.encoding);
	json.addProperty('alphaDepth', blp.alphaDepth);
	json.addProperty('alphaEncoding', blp.alphaEncoding);
	json.addProperty('mipmaps', blp.containsMipmaps);
	json.addProperty('width', blp.width);
	json.addProperty('height', blp.height);
	json.addProperty('mipmapCount', blp.mapCount);
	json.addProperty('mipmapSizes', blp.mapSizes);

	await json.write(overwriteFiles);
	manifest.succeeded.push({ type: 'META', fileDataID, file: jsonOut });
};

/**
 * Export texture files to the configured format.
 * @param {Array} files - Array of fileDataIDs or file paths
 * @param {boolean} isLocal - Whether files are local
 * @param {number} exportID - Export ID for tracking
 * @param {boolean} isMPQ - Whether files are from MPQ archives
 */
const exportFiles = async (files, isLocal = false, exportID = -1, isMPQ = false) => {
	const format = core.view.config.exportTextureFormat;

	if (format === 'CLIPBOARD') {
		const { fileName, fileDataID } = await getFileInfoPair(files[0]);

		let data;
		if (isMPQ) {
			const raw_data = await core.view.mpq.getFile(fileName);
			data = new BufferWrapper(raw_data);
		} else {
			data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFile(fileDataID));
		}

		const blp = new BLPFile(data);
		const png = blp.toPNG(core.view.config.exportChannelMask);

		platform.clipboard_write_image(png.toBase64());

		log.write('Copied texture to clipboard (%s)', fileName);
		core.setToast('success', `Selected texture ${fileName} has been copied to the clipboard`, null, -1, true);

		return;
	}

	const helper = new ExportHelper(files.length, 'texture');
	helper.start();

	const exportPaths = core.openLastExportStream();

	const overwriteFiles = isLocal || core.view.config.overwriteFiles;
	const exportMeta = core.view.config.exportBLPMeta;

	const manifest = { type: 'TEXTURES', exportID, succeeded: [], failed: [] };

	for (let fileEntry of files) {
		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		const { fileName, fileDataID } = await getFileInfoPair(fileEntry);

		try {
			let exportFileName = fileName;

			// Use fileDataID as filename if exportNamedFiles is disabled
			if (!isLocal && !core.view.config.exportNamedFiles) {
				const ext = fileName.toLowerCase().endsWith('.blp') ? '.blp' : '.png';
				const last_slash = fileName.lastIndexOf('/');
				const dir = last_slash === -1 ? '.' : fileName.substring(0, last_slash);
				const fileDataIDName = fileDataID + ext;
				exportFileName = dir === '.' ? fileDataIDName : dir + '/' + fileDataIDName;
			}

			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(exportFileName);
			let markFileName = exportFileName;
			if (format === 'WEBP') {
				exportPath = ExportHelper.replaceExtension(exportPath, '.webp');
				markFileName = ExportHelper.replaceExtension(exportFileName, '.webp');
			} else if (format !== 'BLP') {
				exportPath = ExportHelper.replaceExtension(exportPath, '.png');
				markFileName = ExportHelper.replaceExtension(exportFileName, '.png');
			}

			if (overwriteFiles || !await generics.fileExists(exportPath)) {
				let data;
				if (isMPQ) {
					const raw_data = await core.view.mpq.getFile(fileName);
					data = new BufferWrapper(raw_data);
				} else {
					data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFile(fileDataID));
				}

				const file_ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

				if (file_ext === '.png' || file_ext === '.jpg') {
					// raw export for png/jpg (no blp conversion)
					await data.writeToFile(exportPath);
					await exportPaths?.writeLine(file_ext.slice(1).toUpperCase() + ':' + exportPath);
				} else if (format === 'BLP') {
					// export as raw file with no conversion
					await data.writeToFile(exportPath);
					await exportPaths?.writeLine('BLP:' + exportPath);
				} else if (format === 'WEBP') {
					// export as webp
					const blp = new BLPFile(data);
					await blp.saveToWebP(exportPath, core.view.config.exportChannelMask, 0, core.view.config.exportWebPQuality);
					await exportPaths?.writeLine('WEBP:' + exportPath);

					if (exportMeta)
						await exportBLPMetadata(blp, exportPath, overwriteFiles, manifest, fileDataID);
				} else {
					// export as png
					const blp = new BLPFile(data);
					await blp.saveToPNG(exportPath, core.view.config.exportChannelMask);
					await exportPaths?.writeLine('PNG:' + exportPath);

					if (exportMeta)
						await exportBLPMetadata(blp, exportPath, overwriteFiles, manifest, fileDataID);
				}
			} else {
				log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			}

			helper.mark(markFileName, true);
			manifest.succeeded.push({ type: format, fileDataID, file: exportPath });
		} catch (e) {
			helper.mark(markFileName, false, e.message, e.stack);
			manifest.failed.push({ type: format, fileDataID });
		}
	}

	exportPaths?.close();

	helper.finish();
};

/**
 * Export a single texture by fileDataID.
 * @param {number} fileDataID - The fileDataID of the texture to export
 */
const exportSingleTexture = async (fileDataID) => {
	await exportFiles([fileDataID], false);
};

export { exportFiles, exportSingleTexture, getFileInfoPair };

export default { exportFiles, exportSingleTexture, getFileInfoPair };
