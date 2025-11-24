const path = require('path');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const BLTEIntegrityError = require('../casc/blte-reader').BLTEIntegrityError;
const generics = require('../generics');
const listfile = require('../casc/listfile');
const VP9AVIDemuxer = require('../casc/vp9-avi-demuxer');
const InstallType = require('../install-type');

let current_media_source = null;
let current_video_decoder = null;
let selected_file = null;
let should_stop = false;
let is_playing = false;
let pending_frames = [];

const stop_video = async (core) => {
	should_stop = true;
	core.view.videoPlayerState = false;

	for (const frame of pending_frames) {
		try {
			frame.close();
		} catch (e) {
			// ignore if already closed
		}
	}
	pending_frames = [];

	let attempts = 0;
	while (is_playing && attempts < 50) {
		await new Promise(resolve => setTimeout(resolve, 100));
		attempts++;
	}

	if (current_video_decoder) {
		try {
			if (current_video_decoder.state !== 'closed')
				current_video_decoder.close();
		} catch (e) {
			log.write('error closing decoder: %s', e.message);
		}
		current_video_decoder = null;
	}

	if (current_media_source) {
		try {
			if (current_media_source.readyState === 'open')
				current_media_source.endOfStream();
		} catch (e) {
			log.write('error ending stream: %s', e.message);
		}
		current_media_source = null;
	}

	const canvas = document.getElementById('video-preview-canvas');
	if (canvas) {
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}

	log.write('video stopped, is_playing: %s', is_playing);
};

const play_video = async (core, file_name) => {
	const file_data_id = listfile.getByFilename(file_name);

	if (!file_data_id) {
		core.setToast('error', 'unable to find file in listfile');
		return;
	}

	log.write('play_video called for: %s, is_playing: %s, should_stop: %s', file_name, is_playing, should_stop);

	try {
		await stop_video(core);
		should_stop = false;
		is_playing = true;

		log.write('starting playback for: %s', file_name);

		const stream_reader = await core.view.casc.getFileStream(file_data_id);

		log.write('streaming video %s (%d blocks, %s total)',
			file_name,
			stream_reader.getBlockCount(),
			generics.filesize(stream_reader.getTotalSize())
		);

		log.write('initializing vp9 decoder...');
		const demuxer = new VP9AVIDemuxer(stream_reader);
		const config = await demuxer.parse_header();

		if (!config)
			throw new Error('failed to parse avi header');

		log.write('video config: %dx%d @ %d fps, codec: %s',
			config.codedWidth,
			config.codedHeight,
			demuxer.frame_rate,
			config.codec
		);

		const support = await VideoDecoder.isConfigSupported(config);
		if (!support.supported)
			throw new Error(`vp9 codec not supported: ${config.codec}`);

		const canvas = document.getElementById('video-preview-canvas');
		if (!canvas)
			throw new Error('video-preview-canvas element not found');

		const ctx = canvas.getContext('2d', { alpha: false });

		const frame_duration_ms = 1000 / demuxer.frame_rate;
		pending_frames = [];
		let playback_start_time = null;
		let frames_rendered = 0;

		const decoder = new VideoDecoder({
			output(frame) {
				pending_frames.push(frame);
				if (pending_frames.length === 1 && !should_stop)
					requestAnimationFrame(render_next_frame);
			},
			error(e) {
				log.write('decoder error: %s', e.message);
				core.setToast('error', 'video decode error: ' + e.message);
			}
		});

		const render_next_frame = () => {
			if (pending_frames.length === 0 || should_stop)
				return;

			if (playback_start_time === null)
				playback_start_time = performance.now();

			const frame = pending_frames.shift();
			const elapsed_time = performance.now() - playback_start_time;
			const expected_time = frames_rendered * frame_duration_ms;
			const delay = expected_time - elapsed_time;

			const do_render = () => {
				if (should_stop) {
					frame.close();
					return;
				}

				canvas.width = frame.displayWidth;
				canvas.height = frame.displayHeight;
				ctx.drawImage(frame, 0, 0);
				frame.close();
				frames_rendered++;

				if (pending_frames.length > 0 && !should_stop)
					requestAnimationFrame(render_next_frame);
			};

			if (delay > 0)
				setTimeout(do_render, delay);
			else
				do_render();
		};

		decoder.configure(config);
		current_video_decoder = decoder;
		core.view.videoPlayerState = true;

		log.write('streaming vp9 frames at %d fps...', demuxer.frame_rate);

		let frame_count = 0;

		for await (const frame_info of demuxer.extract_frames()) {
			if (should_stop) {
				log.write('breaking out of frame loop, should_stop is true');
				break;
			}

			if (!frame_info.data || frame_info.data.length === 0) {
				log.write('skipping empty frame at timestamp %d', frame_info.timestamp);
				continue;
			}

			const chunk = new EncodedVideoChunk(frame_info);

			if (decoder.state !== 'closed')
				decoder.decode(chunk);
			else
				break;

			frame_count++;
		}

		log.write('frame loop exited, frame_count: %d, should_stop: %s', frame_count, should_stop);

		is_playing = false;
		log.write('is_playing set to false');

		if (!should_stop) {
			await decoder.flush();
			core.view.videoPlayerState = false;
			log.write('video playback complete (%d frames)', frame_count);
		} else {
			log.write('video playback stopped (%d frames processed)', frame_count);
		}
	} catch (e) {
		is_playing = false;
		core.view.videoPlayerState = false;

		if (e.message && e.message.includes('Aborted due to close()')) {
			log.write('video playback aborted: %s', file_name);
			return;
		}

		log.write('failed to stream video %s: %s', file_name, e.message);
		log.write(e.stack);
		core.setToast('error', 'failed to load video: ' + e.message, { 'view log': () => log.openRuntimeLog() }, -1);
	}
};

module.exports = {
	register() {
		this.registerNavButton('Videos', 'film.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-video">
			<div class="list-container">
				<listbox v-model:selection="$core.view.selectionVideos" :items="$core.view.listfileVideos" :filter="$core.view.userInputFilterVideos" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="video" persistscrollkey="videos"></listbox>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterVideos" placeholder="Filter videos..."/>
			</div>
			<div class="preview-container">
				<canvas id="video-preview-canvas" class="preview-background" style="width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; background: #000;"></canvas>
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
			await play_video(this.$core, file_name);
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

	mounted() {
		this.$core.view.$watch('selectionVideos', async selection => {
			if (selection.length === 0)
				return;

			const file_name = listfile.stripFileEntry(selection[0]);
			if (!this.$core.view.isBusy && file_name && selected_file !== file_name) {
				selected_file = file_name;

				if (this.$core.view.config.videoPlayerAutoPlay)
					await play_video(this.$core, file_name);
			}
		});
	}
};
