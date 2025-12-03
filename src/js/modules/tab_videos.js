const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const BLTEIntegrityError = require('../casc/blte-reader').BLTEIntegrityError;
const generics = require('../generics');
const listfile = require('../casc/listfile');
const db2 = require('../casc/db2');
const InstallType = require('../install-type');
const constants = require('../constants');
const core = require('../core');
const subtitles = require('../subtitles');
const { BlobPolyfill, URLPolyfill } = require('../blob');

let movie_variation_map = null;
let video_file_data_ids = null;
let selected_file = null;
let current_video_element = null;
let current_subtitle_track = null;
let current_subtitle_blob_url = null;
let is_streaming = false;
let poll_timer = null;
let poll_cancelled = false;

const stop_video = async (core_ref) => {
	poll_cancelled = true;

	if (poll_timer) {
		clearTimeout(poll_timer);
		poll_timer = null;
	}

	if (current_video_element) {
		current_video_element.pause();
		current_video_element.onerror = null;
		current_video_element.onended = null;
		current_video_element.src = '';

		if (current_subtitle_track) {
			current_video_element.removeChild(current_subtitle_track);
			current_subtitle_track = null;
		}

		current_video_element.load();
		current_video_element = null;
	}

	if (current_subtitle_blob_url) {
		URLPolyfill.revokeObjectURL(current_subtitle_blob_url);
		current_subtitle_blob_url = null;
	}

	is_streaming = false;
	core_ref.view.videoPlayerState = false;
};

const build_payload = async (core_ref, file_data_id) => {
	const casc = core_ref.view.casc;

	// get video encoding info
	const vid_info = await casc.getFileEncodingInfo(file_data_id);
	if (!vid_info) {
		log.write('failed to get encoding info for video file %d', file_data_id);
		return null;
	}

	const payload = { vid: vid_info };
	const result = { payload, subtitle: null };

	// check if we have movie mapping
	if (movie_variation_map) {
		const movie_id = movie_variation_map.get(file_data_id);
		if (movie_id) {
			try {
				const movie_row = await db2.Movie.getRow(movie_id);
				if (movie_row) {
					// get audio file encoding info
					if (movie_row.AudioFileDataID && movie_row.AudioFileDataID !== 0) {
						const aud_info = await casc.getFileEncodingInfo(movie_row.AudioFileDataID);
						if (aud_info)
							payload.aud = aud_info;
					}

					// get subtitle file encoding info for server + store for local loading
					if (movie_row.SubtitleFileDataID && movie_row.SubtitleFileDataID !== 0) {
						const srt_info = await casc.getFileEncodingInfo(movie_row.SubtitleFileDataID);
						if (srt_info) {
							payload.srt = srt_info;
							payload.srt.type = movie_row.SubtitleFileFormat || 0;
						}

						result.subtitle = {
							file_data_id: movie_row.SubtitleFileDataID,
							format: movie_row.SubtitleFileFormat || 0
						};
					}
				}
			} catch (e) {
				log.write('failed to lookup movie data for movie_id %d: %s', movie_id, e.message);
			}
		}
	}

	return result;
};

const stream_video = async (core_ref, file_name, video) => {
	const file_data_id = listfile.getByFilename(file_name);

	if (!file_data_id) {
		core_ref.setToast('error', 'Unable to find file in listfile');
		return;
	}

	log.write('stream_video called for: %s (fdid: %d)', file_name, file_data_id);

	try {
		await stop_video(core_ref);
		poll_cancelled = false;
		is_streaming = true;
		core_ref.view.videoPlayerState = true;

		const build_result = await build_payload(core_ref, file_data_id);
		if (!build_result) {
			core_ref.setToast('error', 'Failed to get video encoding info');
			is_streaming = false;
			core_ref.view.videoPlayerState = false;
			return;
		}

		const { payload, subtitle } = build_result;
		log.write('sending kino request: %o', payload);

		const send_request = async () => {
			const res = await fetch(constants.KINO.API_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': constants.USER_AGENT
				},
				body: JSON.stringify(payload)
			});

			return res;
		};

		const handle_response = async (res) => {
			if (poll_cancelled)
				return;

			if (res.status === 200) {
				const data = await res.json();
				if (data.url) {
					log.write('received video url: %s', data.url);
					core_ref.hideToast();
					await play_streaming_video(core_ref, data.url, video, subtitle);
				} else {
					throw new Error('server returned 200 but no url');
				}
			} else if (res.status === 202) {
				log.write('video is queued for processing, polling in %dms', constants.KINO.POLL_INTERVAL);

				core_ref.setToast('progress', 'Video is being processed, please wait...', null, -1, true);

				// listen for toast cancellation
				const cancel_handler = () => {
					poll_cancelled = true;
					if (poll_timer) {
						clearTimeout(poll_timer);
						poll_timer = null;
					}
					is_streaming = false;
					core_ref.view.videoPlayerState = false;
					log.write('video processing cancelled by user');
				};

				core_ref.events.once('toast-cancelled', cancel_handler);

				poll_timer = setTimeout(async () => {
					if (poll_cancelled) {
						core_ref.events.off('toast-cancelled', cancel_handler);
						return;
					}

					try {
						const poll_res = await send_request();
						core_ref.events.off('toast-cancelled', cancel_handler);
						await handle_response(poll_res);
					} catch (e) {
						core_ref.events.off('toast-cancelled', cancel_handler);
						if (!poll_cancelled) {
							log.write('poll request failed: %s', e.message);
							core_ref.setToast('error', 'Failed to check video status: ' + e.message, { 'view log': () => log.openRuntimeLog() }, -1);
							is_streaming = false;
							core_ref.view.videoPlayerState = false;
						}
					}
				}, constants.KINO.POLL_INTERVAL);
			} else {
				throw new Error(`server returned ${res.status}`);
			}
		};

		const res = await send_request();
		await handle_response(res);

	} catch (e) {
		is_streaming = false;
		core_ref.view.videoPlayerState = false;

		log.write('failed to stream video %s: %s', file_name, e.message);
		log.write(e.stack);
		core_ref.setToast('error', 'Failed to stream video: ' + e.message, { 'view log': () => log.openRuntimeLog() }, -1);
	}
};

const play_streaming_video = async (core_ref, url, video, subtitle_info) => {
	current_video_element = video;
	video.src = url;

	// always load subtitles if available, toggle visibility based on config
	if (subtitle_info) {
		try {
			const vtt = await subtitles.get_subtitles_vtt(
				core_ref.view.casc,
				subtitle_info.file_data_id,
				subtitle_info.format
			);

			const blob = new BlobPolyfill([vtt], { type: 'text/vtt' });
			current_subtitle_blob_url = URLPolyfill.createObjectURL(blob);

			const track = document.createElement('track');
			track.kind = 'subtitles';
			track.label = 'Subtitles';
			track.srclang = 'en';
			track.src = current_subtitle_blob_url;

			video.appendChild(track);
			current_subtitle_track = track;

			// set initial visibility after track loads
			track.addEventListener('load', () => {
				track.track.mode = core_ref.view.config.videoPlayerShowSubtitles ? 'showing' : 'hidden';
			});

			log.write('loaded subtitles for video (fdid: %d, format: %d)', subtitle_info.file_data_id, subtitle_info.format);
		} catch (e) {
			log.write('failed to load subtitles: %s', e.message);
		}
	}

	video.load();
	video.play().catch(e => {
		log.write('video play failed: %s', e.message);
		core_ref.setToast('error', 'Failed to play video: ' + e.message);
		is_streaming = false;
		core_ref.view.videoPlayerState = false;
	});

	video.onended = () => {
		is_streaming = false;
		core_ref.view.videoPlayerState = false;
		log.write('video playback complete');
	};

	video.onerror = () => {
		const error = video.error;
		log.write('video error: %s', error ? error.message : 'unknown');
		core_ref.setToast('error', 'Video playback error');
		is_streaming = false;
		core_ref.view.videoPlayerState = false;
	};
};

const load_video_listfile = async () => {
	try {
		log.write('loading MovieVariation table...');
		const movie_variation = await db2.preload.MovieVariation();

		movie_variation_map = new Map();
		const seen_ids = new Set();
		video_file_data_ids = [];

		const rows = await movie_variation.getAllRows();

		for (const [id, row] of rows) {
			if (row.FileDataID && row.MovieID) {
				movie_variation_map.set(row.FileDataID, row.MovieID);

				if (!seen_ids.has(row.FileDataID)) {
					seen_ids.add(row.FileDataID);
					video_file_data_ids.push(row.FileDataID);
				}
			}
		}

		log.write('loaded %d movie variation mappings', movie_variation_map.size);

		// build the listfile from FileDataIDs
		const entries = new Array(video_file_data_ids.length);
		for (let i = 0; i < video_file_data_ids.length; i++) {
			const fid = video_file_data_ids[i];
			let filename = listfile.getByID(fid);

			if (!filename) {
				filename = 'interface/cinematics/unk_' + fid + '.avi';
				listfile.addEntry(fid, filename);
			}

			entries[i] = `${filename} [${fid}]`;
		}

		if (core.view.config.listfileSortByID)
			entries.sort((a, b) => listfile.getByFilename(listfile.stripFileEntry(a)) - listfile.getByFilename(listfile.stripFileEntry(b)));
		else
			entries.sort();

		core.view.listfileVideos = entries;
		log.write('built video listfile with %d entries', entries.length);
	} catch (e) {
		log.write('failed to load MovieVariation table: %s', e.message);
		movie_variation_map = null;
		video_file_data_ids = null;
	}
};

const get_movie_data = async (file_data_id) => {
	if (!movie_variation_map)
		return null;

	const movie_id = movie_variation_map.get(file_data_id);
	if (!movie_id)
		return null;

	try {
		const movie_row = await db2.Movie.getRow(movie_id);
		if (!movie_row)
			return null;

		return {
			AudioFileDataID: movie_row.AudioFileDataID || 0,
			SubtitleFileDataID: movie_row.SubtitleFileDataID || 0,
			SubtitleFileFormat: movie_row.SubtitleFileFormat || 0
		};
	} catch (e) {
		log.write('failed to get movie data for fdid %d: %s', file_data_id, e.message);
		return null;
	}
};

const get_mp4_url = async (payload) => {
	const send_request = async () => {
		const res = await fetch(constants.KINO.API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': constants.USER_AGENT
			},
			body: JSON.stringify(payload)
		});
		return res;
	};

	const poll_for_url = async () => {
		const res = await send_request();

		if (res.status === 200) {
			const data = await res.json();
			return data.url || null;
		} else if (res.status === 202) {
			// video queued, wait and retry
			await new Promise(resolve => setTimeout(resolve, constants.KINO.POLL_INTERVAL));
			return poll_for_url();
		}

		return null;
	};

	return poll_for_url();
};

let kino_processing_cancelled = false;

const trigger_kino_processing = async () => {
	if (!video_file_data_ids || video_file_data_ids.length === 0) {
		log.write('kino_processing: no video file data ids loaded');
		core.setToast('error', 'Videos not loaded. Open the Videos tab first.');
		return;
	}

	kino_processing_cancelled = false;
	const total = video_file_data_ids.length;
	let processed = 0;
	let errors = 0;

	log.write('kino_processing: starting processing of %d videos', total);

	const update_toast = () => {
		if (kino_processing_cancelled)
			return;

		const msg = `Processing videos: ${processed}/${total} (${errors} errors)`;
		core.setToast('progress', msg, { 'Cancel': cancel_processing }, -1, true);
	};

	const cancel_processing = () => {
		kino_processing_cancelled = true;
		log.write('kino_processing: cancelled by user at %d/%d', processed, total);
		core.setToast('info', `Video processing cancelled. Processed ${processed}/${total} videos.`);
	};

	core.events.once('toast-cancelled', cancel_processing);

	update_toast();

	for (const file_data_id of video_file_data_ids) {
		if (kino_processing_cancelled)
			break;

		try {
			const build_result = await build_payload(core, file_data_id);
			if (!build_result) {
				log.write('kino_processing: failed to build payload for fdid %d', file_data_id);
				errors++;
				processed++;
				update_toast();
				continue;
			}

			const { payload } = build_result;

			// poll until we get 200 or error
			let done = false;
			while (!done && !kino_processing_cancelled) {
				const res = await fetch(constants.KINO.API_URL, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'User-Agent': constants.USER_AGENT
					},
					body: JSON.stringify(payload)
				});

				if (res.status === 200) {
					done = true;
				} else if (res.status === 202) {
					await new Promise(resolve => setTimeout(resolve, constants.KINO.POLL_INTERVAL));
				} else {
					log.write('kino_processing: unexpected status %d for fdid %d', res.status, file_data_id);
					errors++;
					done = true;
				}
			}
		} catch (e) {
			log.write('kino_processing: error processing fdid %d: %s', file_data_id, e.message);
			errors++;
		}

		processed++;
		update_toast();
	}

	core.events.off('toast-cancelled', cancel_processing);

	if (!kino_processing_cancelled) {
		log.write('kino_processing: completed %d/%d videos with %d errors', processed, total, errors);
		core.setToast('success', `Video processing complete. ${processed}/${total} videos, ${errors} errors.`);
	}
};

// expose to window in dev mode
if (!BUILD_RELEASE)
	window.trigger_kino_processing = trigger_kino_processing;

module.exports = {
	register() {
		this.registerNavButton('Videos', 'film.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-video">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionVideos" :items="$core.view.listfileVideos" :filter="$core.view.userInputFilterVideos" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="video" persistscrollkey="videos"></component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterVideos" placeholder="Filter videos..."/>
			</div>
			<div class="preview-container">
				<video ref="video_player" class="preview-background" style="width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; background: #000;" controls controlsList="nodownload noplaybackrate" disablePictureInPicture></video>
			</div>
			<div class="preview-controls">
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.videoPlayerAutoPlay"/>
					<span>Autoplay</span>
				</label>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.videoPlayerShowSubtitles"/>
					<span>Show Subtitles</span>
				</label>
				<div class="tray"></div>
				<component :is="$components.MenuButton" :options="$core.view.menuButtonVideos" :default="$core.view.config.exportVideoFormat" @change="$core.view.config.exportVideoFormat = $event" :disabled="$core.view.isBusy" @click="export_selected"></component>
			</div>
		</div>
	`,

	methods: {
		async preview_video() {
			if (this.$core.view.videoPlayerState) {
				await stop_video(this.$core);
				return;
			}

			const selection = this.$core.view.selectionVideos;
			if (selection.length === 0) {
				this.$core.setToast('info', 'Select a video file first');
				return;
			}

			const file_name = listfile.stripFileEntry(selection[0]);
			selected_file = file_name;
			await stream_video(this.$core, file_name, this.$refs.video_player);
		},

		async export_selected() {
			const format = this.$core.view.config.exportVideoFormat;

			switch (format) {
				case 'MP4':
					return this.export_mp4();
				case 'AVI':
					return this.export_avi();
				case 'MP3':
					return this.export_mp3();
				case 'SUBTITLES':
					return this.export_subtitles();
			}
		},

		async export_mp4() {
			const user_selection = this.$core.view.selectionVideos;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'video');
			helper.start();

			const overwrite_files = this.$core.view.config.overwriteFiles;
			for (let file_name of user_selection) {
				if (helper.isCancelled())
					return;

				file_name = listfile.stripFileEntry(file_name);
				const file_data_id = listfile.getByFilename(file_name);

				if (!file_data_id) {
					helper.mark(file_name, false, 'File not found in listfile');
					continue;
				}

				let export_file_name = ExportHelper.replaceExtension(file_name, '.mp4');
				if (!this.$core.view.config.exportNamedFiles) {
					const dir = path.dirname(file_name);
					const file_data_id_name = file_data_id + '.mp4';
					export_file_name = dir === '.' ? file_data_id_name : path.join(dir, file_data_id_name);
				}

				const export_path = ExportHelper.getExportPath(export_file_name);

				if (!overwrite_files && await generics.fileExists(export_path)) {
					helper.mark(export_file_name, true);
					log.write('Skipping MP4 export %s (file exists, overwrite disabled)', export_path);
					continue;
				}

				try {
					const build_result = await build_payload(this.$core, file_data_id);
					if (!build_result) {
						helper.mark(export_file_name, false, 'Failed to get encoding info');
						continue;
					}

					const { payload } = build_result;
					const mp4_url = await get_mp4_url(payload);

					if (!mp4_url) {
						helper.mark(export_file_name, false, 'Failed to get MP4 URL from server');
						continue;
					}

					const response = await fetch(mp4_url, {
						headers: { 'User-Agent': constants.USER_AGENT }
					});

					if (!response.ok) {
						helper.mark(export_file_name, false, 'Failed to download MP4: ' + response.status);
						continue;
					}

					const buffer = await response.arrayBuffer();
					await fsp.mkdir(path.dirname(export_path), { recursive: true });
					await fsp.writeFile(export_path, Buffer.from(buffer));

					helper.mark(export_file_name, true);
				} catch (e) {
					helper.mark(export_file_name, false, e.message, e.stack);
				}
			}

			helper.finish();
		},

		async export_avi() {
			const user_selection = this.$core.view.selectionVideos;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'video');
			helper.start();

			const overwrite_files = this.$core.view.config.overwriteFiles;
			for (let file_name of user_selection) {
				if (helper.isCancelled())
					return;

				file_name = listfile.stripFileEntry(file_name);
				let export_file_name = file_name;

				if (!this.$core.view.config.exportNamedFiles) {
					const file_data_id = listfile.getByFilename(file_name);
					if (file_data_id) {
						const ext = path.extname(file_name);
						const dir = path.dirname(file_name);
						const file_data_id_name = file_data_id + ext;
						export_file_name = dir === '.' ? file_data_id_name : path.join(dir, file_data_id_name);
					}
				}

				const export_path = ExportHelper.getExportPath(export_file_name);
				let is_corrupted = false;

				if (overwrite_files || !await generics.fileExists(export_path)) {
					try {
						const data = await this.$core.view.casc.getFileByName(file_name);
						await data.writeToFile(export_path);

						helper.mark(export_file_name, true);
					} catch (e) {
						if (e instanceof BLTEIntegrityError)
							is_corrupted = true;
						else
							helper.mark(export_file_name, false, e.message, e.stack);
					}

					if (is_corrupted) {
						try {
							log.write('Local cinematic file is corrupted, forcing fallback.');

							const data = await this.$core.view.casc.getFileByName(file_name, false, false, true, true);
							await data.writeToFile(export_path);

							helper.mark(export_file_name, true);
						} catch (e) {
							helper.mark(export_file_name, false, e.message, e.stack);
						}
					}
				} else {
					helper.mark(export_file_name, true);
					log.write('Skipping video export %s (file exists, overwrite disabled)', export_path);
				}
			}

			helper.finish();
		},

		async export_mp3() {
			const user_selection = this.$core.view.selectionVideos;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'audio track');
			helper.start();

			const overwrite_files = this.$core.view.config.overwriteFiles;
			for (let file_name of user_selection) {
				if (helper.isCancelled())
					return;

				file_name = listfile.stripFileEntry(file_name);
				const file_data_id = listfile.getByFilename(file_name);

				if (!file_data_id) {
					helper.mark(file_name, false, 'File not found in listfile');
					continue;
				}

				const movie_data = await get_movie_data(file_data_id);
				if (!movie_data || !movie_data.AudioFileDataID) {
					helper.mark(file_name, false, 'No audio track available for this video');
					continue;
				}

				let export_file_name = ExportHelper.replaceExtension(file_name, '.mp3');
				if (!this.$core.view.config.exportNamedFiles) {
					const dir = path.dirname(file_name);
					const file_data_id_name = movie_data.AudioFileDataID + '.mp3';
					export_file_name = dir === '.' ? file_data_id_name : path.join(dir, file_data_id_name);
				}

				const export_path = ExportHelper.getExportPath(export_file_name);

				if (!overwrite_files && await generics.fileExists(export_path)) {
					helper.mark(export_file_name, true);
					log.write('Skipping audio export %s (file exists, overwrite disabled)', export_path);
					continue;
				}

				try {
					const data = await this.$core.view.casc.getFile(movie_data.AudioFileDataID);
					await data.writeToFile(export_path);
					helper.mark(export_file_name, true);
				} catch (e) {
					helper.mark(export_file_name, false, e.message, e.stack);
				}
			}

			helper.finish();
		},

		async export_subtitles() {
			const user_selection = this.$core.view.selectionVideos;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'subtitle');
			helper.start();

			const overwrite_files = this.$core.view.config.overwriteFiles;
			for (let file_name of user_selection) {
				if (helper.isCancelled())
					return;

				file_name = listfile.stripFileEntry(file_name);
				const file_data_id = listfile.getByFilename(file_name);

				if (!file_data_id) {
					helper.mark(file_name, false, 'File not found in listfile');
					continue;
				}

				const movie_data = await get_movie_data(file_data_id);
				if (!movie_data || !movie_data.SubtitleFileDataID) {
					helper.mark(file_name, false, 'No subtitles available for this video');
					continue;
				}

				// determine extension based on subtitle format
				const ext = movie_data.SubtitleFileFormat === subtitles.SUBTITLE_FORMAT.SBT ? '.sbt' : '.srt';

				let export_file_name = ExportHelper.replaceExtension(file_name, ext);
				if (!this.$core.view.config.exportNamedFiles) {
					const dir = path.dirname(file_name);
					const file_data_id_name = movie_data.SubtitleFileDataID + ext;
					export_file_name = dir === '.' ? file_data_id_name : path.join(dir, file_data_id_name);
				}

				const export_path = ExportHelper.getExportPath(export_file_name);

				if (!overwrite_files && await generics.fileExists(export_path)) {
					helper.mark(export_file_name, true);
					log.write('Skipping subtitle export %s (file exists, overwrite disabled)', export_path);
					continue;
				}

				try {
					const data = await this.$core.view.casc.getFile(movie_data.SubtitleFileDataID);
					await data.writeToFile(export_path);
					helper.mark(export_file_name, true);
				} catch (e) {
					helper.mark(export_file_name, false, e.message, e.stack);
				}
			}

			helper.finish();
		}
	},

	async mounted() {
		this.$core.showLoadingScreen(1);

		try {
			await core.progressLoadingScreen('Loading video metadata...');
			await load_video_listfile();
			this.$core.hideLoadingScreen();
		} catch (e) {
			this.$core.hideLoadingScreen();
			log.write('failed to initialize videos tab: %s', e.message);
		}

		this.$core.view.$watch('selectionVideos', async selection => {
			if (selection.length === 0)
				return;

			const file_name = listfile.stripFileEntry(selection[0]);
			if (!this.$core.view.isBusy && file_name && selected_file !== file_name) {
				// cancel any pending polls when selection changes
				poll_cancelled = true;
				if (poll_timer) {
					clearTimeout(poll_timer);
					poll_timer = null;
				}

				selected_file = file_name;

				if (this.$core.view.config.videoPlayerAutoPlay)
					await stream_video(this.$core, file_name, this.$refs.video_player);
			}
		});

		this.$core.view.$watch('config.videoPlayerShowSubtitles', show => {
			if (current_subtitle_track && current_subtitle_track.track)
				current_subtitle_track.track.mode = show ? 'showing' : 'hidden';
		});
	}
};
