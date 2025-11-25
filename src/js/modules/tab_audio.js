const path = require('path');
const util = require('util');
const log = require('../log');
const generics = require('../generics');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const db2 = require('../casc/db2');
const audioHelper = require('../ui/audio-helper');
const InstallType = require('../install-type');

const { PLAYBACK_STATE, PlaybackState, AudioSourceManager, AUDIO_TYPE_UNKNOWN, AUDIO_TYPE_OGG, AUDIO_TYPE_MP3, detectFileType } = audioHelper;

let selected_file = null;
let is_track_loaded = false;
let has_sound_data_loaded = false;

let audio_context = null;
let audio_buffer = null;
let gain_node = null;
let animation_frame_id = null;
let data;

const playback_state = new PlaybackState();
const source_manager = new AudioSourceManager();

const update_seek = (core) => {
	if (!audio_buffer || playback_state.state !== PLAYBACK_STATE.PLAYING) {
		animation_frame_id = null;
		return;
	}

	const current_position = playback_state.get_current_position(audio_buffer, audio_context, core.view.config.soundPlayerLoop);
	core.view.soundPlayerSeek = current_position / audio_buffer.duration;

	animation_frame_id = requestAnimationFrame(() => update_seek(core));
};

const start_animation_loop = (core) => {
	if (animation_frame_id === null)
		update_seek(core);
};

const stop_animation_loop = () => {
	if (animation_frame_id !== null) {
		cancelAnimationFrame(animation_frame_id);
		animation_frame_id = null;
	}
};

const start_playback = (core) => {
	if (!is_track_loaded || !audio_buffer)
		return;

	if (playback_state.state === PLAYBACK_STATE.PLAYING)
		return;

	const start_position = playback_state.position_at_pause;

	source_manager.set_loop(core.view.config.soundPlayerLoop);
	source_manager.create_source(audio_buffer, audio_context, gain_node, () => {
		if (!source_manager.is_loop_enabled && playback_state.state === PLAYBACK_STATE.PLAYING) {
			playback_state.state = PLAYBACK_STATE.LOADED;
			playback_state.position_at_pause = 0;
			stop_animation_loop();
			core.view.soundPlayerState = false;
			core.view.soundPlayerSeek = 0;
		}
	});
	source_manager.start_source(start_position, audio_buffer);

	playback_state.start_playback(start_position, audio_context);
	core.view.soundPlayerState = true;
	start_animation_loop(core);
};

const stop_playback = (core) => {
	source_manager.destroy_source();
	playback_state.pause_playback();
	playback_state.position_at_pause = 0;
	stop_animation_loop();
	core.view.soundPlayerState = false;
	core.view.soundPlayerSeek = 0;
};

const unload_selected_track = (core) => {
	source_manager.destroy_source();
	stop_animation_loop();

	is_track_loaded = false;
	core.view.soundPlayerState = false;
	core.view.soundPlayerDuration = 0;
	core.view.soundPlayerSeek = 0;
	audio_buffer = null;
	playback_state.reset();

	data?.revokeDataURL();
};

const load_selected_track = async (core) => {
	if (selected_file === null)
		return core.setToast('info', 'You need to select an audio track first!', null, -1, true);

	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', selected_file), null, -1, false);
	log.write('Previewing sound file %s', selected_file);

	try {
		const file_data_id = listfile.getByFilename(selected_file);
		data = await core.view.casc.getFile(file_data_id);

		if (selected_file.endsWith('.unk_sound')) {
			const file_type = detectFileType(data);
			if (file_type === AUDIO_TYPE_OGG)
				core.view.soundPlayerTitle += ' (OGG Auto Detected)';
			else if (file_type === AUDIO_TYPE_MP3)
				core.view.soundPlayerTitle += ' (MP3 Auto Detected)';
		}

		log.write('audio decode: buffer length=%d, byteOffset=%d, byteLength=%d', data.raw.buffer.byteLength, data.raw.byteOffset, data.raw.byteLength);
		log.write('audio decode: first 16 bytes: %s', data.readHexString(16));
		data.seek(0);

		const array_buffer = data.raw.buffer.slice(data.raw.byteOffset, data.raw.byteOffset + data.raw.byteLength);
		log.write('audio decode: sliced array_buffer length=%d', array_buffer.byteLength);

		audio_buffer = await audio_context.decodeAudioData(array_buffer);
		core.view.soundPlayerDuration = audio_buffer.duration;

		is_track_loaded = true;
		playback_state.mark_loaded();
		core.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			core.setToast('error', util.format('The audio file %s is encrypted with an unknown key (%s).', selected_file, e.key), null, -1);
			log.write('Failed to decrypt audio file %s (%s)', selected_file, e.key);
		} else {
			core.setToast('error', 'Unable to preview audio ' + selected_file, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}

	core.view.isBusy--;
};

const play_selected_track = async (core) => {
	if (!is_track_loaded)
		await load_selected_track(core);

	if (is_track_loaded)
		start_playback(core);
};

const pause_selected_track = (core) => {
	if (playback_state.state !== PLAYBACK_STATE.PLAYING)
		return;

	const current_position = playback_state.get_current_position(audio_buffer, audio_context, core.view.config.soundPlayerLoop);
	playback_state.position_at_pause = current_position;
	playback_state.pause_playback();
	source_manager.destroy_source();
	stop_animation_loop();
	core.view.soundPlayerState = false;
};

const seek_to_position = (core, position_seconds) => {
	if (!is_track_loaded || !audio_buffer)
		return;

	const was_playing = playback_state.state === PLAYBACK_STATE.PLAYING;

	if (was_playing) {
		source_manager.destroy_source();
		playback_state.seek_to(position_seconds, audio_buffer);

		const start_position = playback_state.pending_seek || playback_state.position_at_pause;
		playback_state.pending_seek = null;

		source_manager.create_source(audio_buffer, audio_context, gain_node, () => {
			if (!source_manager.is_loop_enabled && playback_state.state === PLAYBACK_STATE.PLAYING) {
				playback_state.state = PLAYBACK_STATE.LOADED;
				playback_state.position_at_pause = 0;
				stop_animation_loop();
				core.view.soundPlayerState = false;
				core.view.soundPlayerSeek = 0;
			}
		});
		source_manager.start_source(start_position, audio_buffer);
		playback_state.start_playback(start_position, audio_context);
	} else {
		playback_state.seek_to(position_seconds, audio_buffer);
		core.view.soundPlayerSeek = playback_state.position_at_pause / audio_buffer.duration;
	}
};

const load_sound_data = async (core) => {
	if (!has_sound_data_loaded && !core.view.isBusy && core.view.config.enableUnknownFiles) {
		core.showLoadingScreen(1);

		try {
			await core.progressLoadingScreen('Processing unknown sound files...');

			let unknown_count = 0;
			for (const entry of (await db2.SoundKitEntry.getAllRows()).values()) {
				if (!listfile.existsByID(entry.FileDataID)) {
					const file_name = 'unknown/' + entry.FileDataID + '.unk_sound';
					listfile.addEntry(entry.FileDataID, file_name, core.view.listfileSounds);
					unknown_count++;
				}
			}

			log.write('Added %d unknown sound files from SoundKitEntry to listfile', unknown_count);
			has_sound_data_loaded = true;
		} catch (e) {
			log.write('Failed to load sound data: %s', e.message);
			core.setToast('error', 'Failed to load sound data', { 'View Log': () => log.openRuntimeLog() }, -1);
		}

		core.hideLoadingScreen('tab-sounds');
	}
};

const export_sounds = async (core) => {
	const user_selection = core.view.selectionSounds;
	if (user_selection.length === 0) {
		core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
		return;
	}

	const helper = new ExportHelper(user_selection.length, 'sound files');
	helper.start();

	const overwrite_files = core.view.config.overwriteFiles;
	for (let file_name of user_selection) {
		if (helper.isCancelled())
			return;

		let file_data;
		file_name = listfile.stripFileEntry(file_name);

		if (file_name.endsWith('.unk_sound')) {
			file_data = await core.view.casc.getFileByName(file_name);
			const file_type = detectFileType(file_data);

			if (file_type === AUDIO_TYPE_OGG)
				file_name = ExportHelper.replaceExtension(file_name, '.ogg');
			else if (file_type === AUDIO_TYPE_MP3)
				file_name = ExportHelper.replaceExtension(file_name, '.mp3');
		}

		let export_file_name = file_name;

		if (!core.view.config.exportNamedFiles) {
			const file_data_id = listfile.getByFilename(file_name);
			if (file_data_id) {
				const ext = path.extname(file_name);
				const dir = path.dirname(file_name);
				const file_data_id_name = file_data_id + ext;
				export_file_name = dir === '.' ? file_data_id_name : path.join(dir, file_data_id_name);
			}
		}

		try {
			const export_path = ExportHelper.getExportPath(export_file_name);
			if (overwrite_files || !await generics.fileExists(export_path)) {
				if (!file_data)
					file_data = await core.view.casc.getFileByName(file_name);

				await file_data.writeToFile(export_path);
			} else {
				log.write('Skipping audio export %s (file exists, overwrite disabled)', export_path);
			}

			helper.mark(file_name, true);
		} catch (e) {
			helper.mark(file_name, false, e.message, e.stack);
		}
	}

	helper.finish();
};

module.exports = {
	register() {
		this.registerNavButton('Audio', 'music.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-sounds">
			<div class="list-container">
				<listbox v-model:selection="$core.view.selectionSounds" :items="$core.view.listfileSounds" :filter="$core.view.userInputFilterSounds" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="sound file" persistscrollkey="sounds"></listbox>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterSounds" placeholder="Filter sound files..."/>
			</div>
			<div id="sound-player">
				<div id="sound-player-anim" :style="{ 'animation-play-state': $core.view.soundPlayerState ? 'running' : 'paused' }"></div>
				<div id="sound-player-controls">
					<div id="sound-player-info">
						<span>{{ $core.view.soundPlayerSeekFormatted }}</span>
						<span class="title">{{ $core.view.soundPlayerTitle }}</span>
						<span>{{ $core.view.soundPlayerDurationFormatted }}</span>
					</div>
					<slider id="slider-seek" v-model="$core.view.soundPlayerSeek" @update:model-value="handle_seek"></slider>
					<div class="buttons">
						<input type="button" :class="{ isPlaying: !$core.view.soundPlayerState }" @click="toggle_playback"/>
						<slider id="slider-volume" v-model="$core.view.config.soundPlayerVolume"></slider>
					</div>
				</div>
			</div>
			<div class="preview-controls">
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.soundPlayerLoop"/>
					<span>Loop</span>
				</label>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.soundPlayerAutoPlay"/>
					<span>Autoplay</span>
				</label>
				<input type="button" value="Export Selected" @click="export_selected" :class="{ disabled: $core.view.isBusy }"/>
			</div>
		</div>
	`,

	methods: {
		toggle_playback() {
			if (this.$core.view.soundPlayerState)
				pause_selected_track(this.$core);
			else
				play_selected_track(this.$core);
		},

		handle_seek(seek) {
			if (audio_buffer && is_track_loaded) {
				const position_seconds = audio_buffer.duration * seek;
				seek_to_position(this.$core, position_seconds);
			}
		},

		async export_selected() {
			await export_sounds(this.$core);
		}
	},

	async mounted() {
		audio_context = new (window.AudioContext || window.webkitAudioContext)();
		gain_node = audio_context.createGain();
		gain_node.connect(audio_context.destination);
		gain_node.gain.value = this.$core.view.config.soundPlayerVolume;

		this.$core.view.$watch('config.soundPlayerVolume', value => {
			gain_node.gain.value = value;
		});

		this.$core.view.$watch('config.soundPlayerLoop', value => {
			source_manager.set_loop(value);
		});

		this.$core.view.$watch('selectionSounds', async selection => {
			const first = listfile.stripFileEntry(selection[0]);
			if (!this.$core.view.isBusy && first && selected_file !== first) {
				this.$core.view.soundPlayerTitle = path.basename(first);

				selected_file = first;
				unload_selected_track(this.$core);

				if (this.$core.view.config.soundPlayerAutoPlay)
					play_selected_track(this.$core);
			}
		});

		this.$core.events.on('crash', () => {
			unload_selected_track(this.$core);

			if (audio_context) {
				audio_context.close();
				audio_context = null;
			}
		});

		await load_sound_data(this.$core);
	}
};
