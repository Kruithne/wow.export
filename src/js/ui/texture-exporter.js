/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const generics = require('../generics');
const listfile = require('../casc/listfile');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const JSONWriter = require('../3D/writers/JSONWriter');

/**
 * Retrieve the fileDataID and fileName for a given fileDataID or fileName.
 * @param {number|string} input 
 * @returns {object}
 */
const getFileInfoPair = (input) => {
	let fileName;
	let fileDataID;

	if (typeof input === 'number') {
		fileDataID = input;
		fileName = listfile.getByID(fileDataID) ?? listfile.formatUnknownFile(fileDataID, '.blp');
	} else {
		fileName = listfile.stripFileEntry(input);
		fileDataID = listfile.getByFilename(fileName);
	}

	return { fileName, fileDataID };
};

/**
 * Export texture files to the configured format.
 * @param {Array} files - Array of fileDataIDs or file paths
 * @param {boolean} isLocal - Whether files are local
 * @param {number} exportID - Export ID for tracking
 */
const exportFiles = async (files, isLocal = false, exportID = -1) => {
	const format = core.view.config.exportTextureFormat;

	if (format === 'CLIPBOARD') {
		const { fileName, fileDataID } = getFileInfoPair(files[0]);

		const data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFile(fileDataID));
		const blp = new BLPFile(data);
		const png = blp.toPNG(core.view.config.exportChannelMask);
		
		const clipboard = nw.Clipboard.get();
		clipboard.set(png.toBase64(), 'png', true);

		log.write('Copied texture to clipboard (%s)', fileName);
		core.setToast('success', util.format('Selected texture %s has been copied to the clipboard', fileName), null, -1, true);

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
			
		const { fileName, fileDataID } = getFileInfoPair(fileEntry);
		
		try {
			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);
			if (format !== 'BLP')
				exportPath = ExportHelper.replaceExtension(exportPath, '.png');

			if (overwriteFiles || !await generics.fileExists(exportPath)) {
				const data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFile(fileDataID));

				if (format === 'BLP') {
					// Export as raw file with no conversion.
					await data.writeToFile(exportPath);
					await exportPaths?.writeLine('BLP:' + exportPath);
				} else {
					// Export as PNG.
					const blp = new BLPFile(data);
					await blp.saveToPNG(exportPath, core.view.config.exportChannelMask);
					await exportPaths?.writeLine('PNG:' + exportPath);

					if (exportMeta) {
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
						manifest.succeeded.push({ type: 'META', fileDataID, file: jsonOut })
					}
				}
			} else {
				log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			}

			helper.mark(fileName, true);
			manifest.succeeded.push({ type: format, fileDataID, file: exportPath });
		} catch (e) {
			helper.mark(fileName, false, e.message, e.stack);
			manifest.failed.push({ type: format, fileDataID });
		}
	}

	exportPaths?.close();

	helper.finish();

	// Dispatch file manifest to RCP.
	core.rcp.dispatchHook('HOOK_EXPORT_COMPLETE', manifest);
};

/**
 * Export a single texture by fileDataID.
 * @param {number} fileDataID - The fileDataID of the texture to export
 */
const exportSingleTexture = async (fileDataID) => {
	await exportFiles([fileDataID], false);
};

module.exports = { exportFiles, exportSingleTexture, getFileInfoPair };