/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import * as platform from '../platform.js';
import core from '../core.js';
import { listfile, exporter as ExportHelper } from '../../views/main/rpc.js';

const parse_entry = async (entry) => {
	const file_path = listfile.stripFileEntry(entry);
	const fid_match = entry.match(/\[(\d+)\]$/);
	const file_data_id = fid_match ? parseInt(fid_match[1], 10) : await listfile.getByFilename(file_path);

	return { filePath: file_path, fileDataID: file_data_id };
};

const get_file_paths = (selection) => {
	return selection.map(entry => listfile.stripFileEntry(entry));
};

const get_listfile_entries = async (selection) => {
	const results = [];
	for (const entry of selection) {
		const { filePath, fileDataID } = await parse_entry(entry);
		results.push(fileDataID ? `${filePath};${fileDataID}` : filePath);
	}
	return results;
};

const get_file_data_ids = async (selection) => {
	const ids = [];
	for (const entry of selection) {
		const { fileDataID } = await parse_entry(entry);
		if (fileDataID !== null && fileDataID !== undefined)
			ids.push(fileDataID);
	}
	return ids;
};

const get_export_paths = (selection) => {
	return selection.map(entry => {
		const file_path = listfile.stripFileEntry(entry);
		return ExportHelper.getExportPath(file_path);
	});
};

const get_export_directory = (selection) => {
	if (selection.length === 0)
		return null;

	const file_path = listfile.stripFileEntry(selection[0]);
	const export_path = ExportHelper.getExportPath(file_path);
	return export_path.substring(0, export_path.lastIndexOf('/'));
};

const copy_file_paths = (selection) => {
	const paths = get_file_paths(selection);
	platform.clipboard_write_text(paths.join('\n'));
};

const copy_listfile_format = async (selection) => {
	const entries = await get_listfile_entries(selection);
	platform.clipboard_write_text(entries.join('\n'));
};

const copy_file_data_ids = async (selection) => {
	const ids = await get_file_data_ids(selection);
	platform.clipboard_write_text(ids.join('\n'));
};

const copy_export_paths = (selection) => {
	const paths = get_export_paths(selection);
	platform.clipboard_write_text(paths.join('\n'));
};

const open_export_directory = (selection) => {
	const dir = get_export_directory(selection);
	if (dir)
		platform.open_path(dir);
};

const has_file_data_ids = async (selection) => {
	if (selection.length === 0)
		return false;

	const { fileDataID } = await parse_entry(selection[0]);
	return fileDataID !== null && fileDataID !== undefined;
};

const handle_context_menu = async (data, isLegacy = false) => {
	core.view.contextMenus.nodeListbox = {
		selection: data.selection,
		count: data.selection.length,
		hasFileDataIDs: !isLegacy && await has_file_data_ids(data.selection)
	};
};

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

export default {
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
