const path = require('path');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const BLTEIntegrityError = require('../casc/blte-reader').BLTEIntegrityError;
const generics = require('../generics');
const listfile = require('../casc/listfile');
const db2 = require('../casc/db2');
const InstallType = require('../install-type');
const constants = require('../constants');
const core = require('../core');

let movie_variation_map = null;
let selected_file = null;
let current_video_element = null;
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
		current_video_element.src = '';
		current_video_element.load();
		current_video_element = null;
	}

	is_streaming = false;
	core_ref.view.videoPlayerState = false;
	log.write('video stopped');
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

					// get subtitle file encoding info
					if (movie_row.SubtitleFileDataID && movie_row.SubtitleFileDataID !== 0) {
						const srt_info = await casc.getFileEncodingInfo(movie_row.SubtitleFileDataID);
						if (srt_info) {
							payload.srt = srt_info;
							payload.srt.type = movie_row.SubtitleFileFormat || 0;
						}
					}
				}
			} catch (e) {
				log.write('failed to lookup movie data for movie_id %d: %s', movie_id, e.message);
			}
		}
	}

	return payload;
};

const stream_video = async (core_ref, file_name) => {
	const file_data_id = listfile.getByFilename(file_name);

	if (!file_data_id) {
		core_ref.setToast('error', 'unable to find file in listfile');
		return;
	}

	log.write('stream_video called for: %s (fdid: %d)', file_name, file_data_id);

	try {
		await stop_video(core_ref);
		poll_cancelled = false;
		is_streaming = true;
		core_ref.view.videoPlayerState = true;

		const payload = await build_payload(core_ref, file_data_id);
		if (!payload) {
			core_ref.setToast('error', 'failed to get video encoding info');
			is_streaming = false;
			core_ref.view.videoPlayerState = false;
			return;
		}

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
					play_streaming_video(core_ref, data.url);
				} else {
					throw new Error('server returned 200 but no url');
				}
			} else if (res.status === 202) {
				log.write('video is queued for processing, polling in %dms', constants.KINO.POLL_INTERVAL);

				core_ref.setToast('progress', 'video is being processed, please wait...', null, -1, true);

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
							core_ref.setToast('error', 'failed to check video status: ' + e.message, { 'view log': () => log.openRuntimeLog() }, -1);
							is_streaming = false;
							core_ref.view.videoPlayerState = false;
						}
					}
				}, constants.KINO.POLL_INTERVAL);
			} else {
				const error_text = await res.text().catch(() => 'unknown error');
				throw new Error(`server returned ${res.status}: ${error_text}`);
			}
		};

		const res = await send_request();
		await handle_response(res);

	} catch (e) {
		is_streaming = false;
		core_ref.view.videoPlayerState = false;

		log.write('failed to stream video %s: %s', file_name, e.message);
		log.write(e.stack);
		core_ref.setToast('error', 'failed to stream video: ' + e.message, { 'view log': () => log.openRuntimeLog() }, -1);
	}
};

const play_streaming_video = (core_ref, url) => {
	const video = document.getElementById('video-preview-player');
	if (!video) {
		log.write('video element not found');
		core_ref.setToast('error', 'video player element not found');
		is_streaming = false;
		core_ref.view.videoPlayerState = false;
		return;
	}

	current_video_element = video;
	video.src = url;
	video.load();
	video.play().catch(e => {
		log.write('video play failed: %s', e.message);
		core_ref.setToast('error', 'failed to play video: ' + e.message);
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
		core_ref.setToast('error', 'video playback error');
		is_streaming = false;
		core_ref.view.videoPlayerState = false;
	};
};

const load_movie_variation_map = async () => {
	try {
		log.write('loading MovieVariation table...');
		const movie_variation = await db2.preload.MovieVariation();

		movie_variation_map = new Map();
		const rows = await movie_variation.getAllRows();

		for (const [id, row] of rows) {
			if (row.FileDataID && row.MovieID)
				movie_variation_map.set(row.FileDataID, row.MovieID);
		}

		log.write('loaded %d movie variation mappings', movie_variation_map.size);
	} catch (e) {
		log.write('failed to load MovieVariation table: %s', e.message);
		movie_variation_map = null;
	}
};

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
				<video id="video-preview-player" class="preview-background" style="width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; background: #000;" controls></video>
			</div>
			<div class="preview-controls">
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.videoPlayerAutoPlay"/>
					<span>Autoplay</span>
				</label>
				<input type="button" :value="$core.view.videoPlayerState ? 'Stop Preview' : 'Preview Selected'" @click="preview_video"/>
				<div class="tray"></div>
				<input type="button" value="Export Selected" @click="export_video" :class="{ disabled: $core.view.isBusy }"/>
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
				this.$core.setToast('info', 'select a video file first');
				return;
			}

			const file_name = listfile.stripFileEntry(selection[0]);
			selected_file = file_name;
			await stream_video(this.$core, file_name);
		},

		async export_video() {
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

						helper.mark(file_name, true);
					} catch (e) {
						if (e instanceof BLTEIntegrityError)
							is_corrupted = true;
						else
							helper.mark(file_name, false, e.message, e.stack);
					}

					if (is_corrupted) {
						try {
							log.write('Local cinematic file is corrupted, forcing fallback.');

							const data = await this.$core.view.casc.getFileByName(file_name, false, false, true, true);
							await data.writeToFile(export_path);

							helper.mark(file_name, true);
						} catch (e) {
							helper.mark(file_name, false, e.message, e.stack);
						}
					}
				} else {
					helper.mark(file_name, true);
					log.write('Skipping video export %s (file exists, overwrite disabled)', export_path);
				}
			}

			helper.finish();
		}
	},

	async mounted() {
		this.$core.showLoadingScreen(1);

		try {
			await core.progressLoadingScreen('Loading video metadata...');
			await load_movie_variation_map();
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
					await stream_video(this.$core, file_name);
			}
		});
	}
};
