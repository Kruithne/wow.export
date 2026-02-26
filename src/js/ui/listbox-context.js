/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import * as platform from '../platform.js';
import core from '../core.js';
import { listfile, exporter as ExportHelper } from '../../views/main/rpc.js';

/**
 * Parse a file entry to extract file path and file data ID.
 * @param {string} entry - File entry in format "path/to/file [123]" or just "path/to/file"
 * @returns {{ filePath: string, fileDataID: number|null }}
 */
const parse_entry = (entry) => {
	const file_path = listfile.stripFileEntry(entry);
	const fid_match = entry.match(/\[(\d+)\]$/);
	const file_data_id = fid_match ? parseInt(fid_match[1], 10) : listfile.getByFilename(file_path);

	return { filePath: file_path, fileDataID: file_data_id };
};

/**
 * Get file paths from selection entries.
 * @param {string[]} selection
 * @returns {string[]}
 */
const get_file_paths = (selection) => {
	return selection.map(entry => listfile.stripFileEntry(entry));
};

/**
 * Get file entries in listfile format (path;fileDataID).
 * @param {string[]} selection
 * @returns {string[]}
 */
const get_listfile_entries = (selection) => {
	return selection.map(entry => {
		const { filePath, fileDataID } = parse_entry(entry);
		return fileDataID ? `${filePath};${fileDataID}` : filePath;
	});
};

/**
 * Get file data IDs from selection entries.
 * @param {string[]} selection
 * @returns {number[]}
 */
const get_file_data_ids = (selection) => {
	return selection.map(entry => {
		const { fileDataID } = parse_entry(entry);
		return fileDataID;
	}).filter(id => id !== null && id !== undefined);
};

/**
 * Get export paths for selection entries.
 * @param {string[]} selection
 * @returns {string[]}
 */
const get_export_paths = (selection) => {
	return selection.map(entry => {
		const file_path = listfile.stripFileEntry(entry);
		return ExportHelper.getExportPath(file_path);
	});
};

/**
 * Get export directory for the first selected entry.
 * @param {string[]} selection
 * @returns {string|null}
 */
const get_export_directory = (selection) => {
	if (selection.length === 0)
		return null;

	const file_path = listfile.stripFileEntry(selection[0]);
	const export_path = ExportHelper.getExportPath(file_path);
	return export_path.substring(0, export_path.lastIndexOf('/'));
};

/**
 * Copy file paths to clipboard.
 * @param {string[]} selection
 */
const copy_file_paths = (selection) => {
	const paths = get_file_paths(selection);
	platform.clipboard_write_text(paths.join('\n'));
};

/**
 * Copy file entries in listfile format to clipboard.
 * @param {string[]} selection
 */
const copy_listfile_format = (selection) => {
	const entries = get_listfile_entries(selection);
	platform.clipboard_write_text(entries.join('\n'));
};

/**
 * Copy file data IDs to clipboard.
 * @param {string[]} selection
 */
const copy_file_data_ids = (selection) => {
	const ids = get_file_data_ids(selection);
	platform.clipboard_write_text(ids.join('\n'));
};

/**
 * Copy export paths to clipboard.
 * @param {string[]} selection
 */
const copy_export_paths = (selection) => {
	const paths = get_export_paths(selection);
	platform.clipboard_write_text(paths.join('\n'));
};

/**
 * Open export directory in file explorer.
 * @param {string[]} selection
 */
const open_export_directory = (selection) => {
	const dir = get_export_directory(selection);
	if (dir)
		platform.open_path(dir);
};

/**
 * Check if selection has file data IDs.
 * @param {string[]} selection
 * @returns {boolean}
 */
const has_file_data_ids = (selection) => {
	if (selection.length === 0)
		return false;

	const { fileDataID } = parse_entry(selection[0]);
	return fileDataID !== null && fileDataID !== undefined;
};

/**
 * Handle context menu event from listbox.
 * @param {object} data - Context menu event data { item, selection, event }
 * @param {boolean} isLegacy - If true, this is a legacy (MPQ) tab without file data IDs
 */
const handle_context_menu = (data, isLegacy = false) => {
	core.view.contextMenus.nodeListbox = {
		selection: data.selection,
		count: data.selection.length,
		hasFileDataIDs: !isLegacy && has_file_data_ids(data.selection)
	};
};

/**
 * Close the context menu.
 */
const close_context_menu = () => {
	core.view.contextMenus.nodeListbox = null;
};

export {
	parse_entry,
	get_file_paths,
	get_listfile_entries,
	get_file_data_ids,
	get_export_paths,
	get_export_directory,
	has_file_data_ids,
	copy_file_paths,
	copy_listfile_format,
	copy_file_data_ids,
	copy_export_paths,
	open_export_directory,
	handle_context_menu,
	close_context_menu
};
