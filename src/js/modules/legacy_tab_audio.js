import log from '../log.js';
import generics from '../generics.js';
import { exporter as ExportHelper } from '../../views/main/rpc.js';
import BufferWrapper from '../buffer.js';
import { AudioPlayer, AUDIO_TYPE_OGG, AUDIO_TYPE_MP3, detectFileType } from '../ui/audio-helper.js';
import listboxContext from '../ui/listbox-context.js';
import InstallType from '../install-type.js';

let selected_file = null;
let animation_frame_id = null;

const player = new AudioPlayer();

const update_seek = (core) => {
	if (!player.is_playing) {
		animation_frame_id = null;
		return;
	}

	const duration = player.get_duration();
	if (duration > 0)
		core.view.soundPlayerSeek = player.get_position() / duration;

	animation_frame_id = requestAnimationFrame(() => update_seek(core));
};

const start_seek_loop = (core) => {
	if (animation_frame_id === null)
		update_seek(core);
};

const stop_seek_loop = () => {
	if (animation_frame_id !== null) {
		cancelAnimationFrame(animation_frame_id);
		animation_frame_id = null;
	}
};

const load_track = async (core) => {
	if (selected_file === null)
		return false;

	using _lock = core.create_busy_lock();
	core.setToast('progress', `Loading ${selected_file}, please wait...`, null, -1, false);
	log.write('Previewing sound file %s', selected_file);

	try {
		const raw_data = core.view.mpq.getFile(selected_file);
		if (!raw_data) {
			log.write('Failed to load audio: %s', selected_file);
			core.setToast('error', 'Failed to load audio file ' + selected_file, null, -1);
			return false;
		}

		const data = new BufferWrapper(raw_data);

		const ext = selected_file.slice(selected_file.lastIndexOf('.')).toLowerCase();
		if (ext === '.wav_') {
			core.view.soundPlayerTitle += ' (WAV)';
		} else {
			const file_type = detectFileType(data);
			if (file_type === AUDIO_TYPE_OGG)
				core.view.soundPlayerTitle += ' (OGG)';
			else if (file_type === AUDIO_TYPE_MP3)
				core.view.soundPlayerTitle += ' (MP3)';
		}

		log.write('audio decode: buffer length=%d, byteOffset=%d, byteLength=%d', buffer.byteLength, 0, buffer.byteLength);
		log.write('audio decode: first 16 bytes: %s', data.readHexString(16));

		const array_buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
		log.write('audio decode: sliced array_buffer length=%d', array_buffer.byteLength);

		await player.load(array_buffer);
		core.view.soundPlayerDuration = player.get_duration();
		core.hideToast();
		return true;
	} catch (e) {
		core.setToast('error', 'Unable to preview audio ' + selected_file, { 'View Log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to load MPQ audio file: %s', e.message);
		return false;
	}
};

const unload_track = (core) => {
	stop_seek_loop();
	player.unload();

	core.view.soundPlayerState = false;
	core.view.soundPlayerDuration = 0;
	core.view.soundPlayerSeek = 0;
};

const play_track = async (core) => {
	if (!player.buffer) {
		if (selected_file === null) {
			core.setToast('info', 'You need to select an audio track first!', null, -1, true);
			return;
		}

		const loaded = await load_track(core);
		if (!loaded)
			return;
	}

	player.play();
	core.view.soundPlayerState = true;
	start_seek_loop(core);
};

const pause_track = (core) => {
	player.pause();
	stop_seek_loop();
	core.view.soundPlayerState = false;
};

const load_sound_list = async (core) => {
	if (core.view.listfileSounds.length === 0 && !core.view.isBusy) {
		using _lock = core.create_busy_lock();

		try {
			const ogg_files = core.view.mpq.getFilesByExtension('.ogg');
			const wav_files = core.view.mpq.getFilesByExtension('.wav');
			const mp3_files = core.view.mpq.getFilesByExtension('.mp3');
			const wav__files = core.view.mpq.getFilesByExtension('.wav_');

			core.view.listfileSounds = [...ogg_files, ...wav_files, ...mp3_files, ...wav__files];
		} catch (e) {
			log.write('failed to load legacy sounds: %o', e);
		}
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

		try {
			let export_file_name = file_name;
			const ext = file_name.slice(file_name.lastIndexOf('.')).toLowerCase();

			if (ext === '.wav_') {
				export_file_name = file_name.slice(0, -1);
			} else {
				const raw_data = core.view.mpq.getFile(file_name);
				if (raw_data) {
					const wrapped = new BufferWrapper(raw_data);
					const file_type = detectFileType(wrapped);

					if (file_type === AUDIO_TYPE_OGG)
						export_file_name = ExportHelper.replaceExtension(file_name, '.ogg');
					else if (file_type === AUDIO_TYPE_MP3)
						export_file_name = ExportHelper.replaceExtension(file_name, '.mp3');
				}
			}

			const export_path = ExportHelper.getExportPath(export_file_name);
			if (overwrite_files || !await generics.fileExists(export_path)) {
				const raw_data = core.view.mpq.getFile(file_name);
				if (!raw_data)
					throw new Error('Failed to read file from MPQ');

				const dir_path = export_path.substring(0, export_path.lastIndexOf('/'));
				await generics.createDirectory(dir_path);
				await generics.writeFile(export_path, new Uint8Array(raw_data));
			} else {
				log.write('Skipping audio export %s (file exists, overwrite disabled)', export_path);
			}

			helper.mark(export_file_name, true);
		} catch (e) {
			helper.mark(export_file_name, false, e.message, e.stack);
		}
	}

	helper.finish();
};

export default {
	register() {
		this.registerNavButton('Audio', 'music.svg', InstallType.MPQ);
	},

	template: `
		<div class="tab list-tab" id="legacy-tab-audio">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionSounds" :items="$core.view.listfileSounds" :filter="$core.view.userInputFilterSounds" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="sound file" persistscrollkey="sounds" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_export_directory(context.node.selection)">Open export directory</span>
				</component>
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
					<component :is="$components.Slider" id="slider-seek" v-model="$core.view.soundPlayerSeek" @update:model-value="handle_seek"></component>
					<div class="buttons">
						<input type="button" :class="{ isPlaying: !$core.view.soundPlayerState }" @click="toggle_playback"/>
						<component :is="$components.Slider" id="slider-volume" v-model="$core.view.config.soundPlayerVolume"></component>
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
		handle_listbox_context(data) {
			listboxContext.handle_context_menu(data, true);
		},

		copy_file_paths(selection) {
			listboxContext.copy_file_paths(selection);
		},

		copy_export_paths(selection) {
			listboxContext.copy_export_paths(selection);
		},

		open_export_directory(selection) {
			listboxContext.open_export_directory(selection);
		},

		toggle_playback() {
			if (this.$core.view.soundPlayerState)
				pause_track(this.$core);
			else
				play_track(this.$core);
		},

		handle_seek(seek) {
			const duration = player.get_duration();
			if (duration > 0)
				player.seek(duration * seek);
		},

		async export_selected() {
			await export_sounds(this.$core);
		}
	},

	async mounted() {
		player.init();
		player.set_volume(this.$core.view.config.soundPlayerVolume);
		player.set_loop(this.$core.view.config.soundPlayerLoop);

		player.on_ended = () => {
			stop_seek_loop();
			this.$core.view.soundPlayerState = false;
			this.$core.view.soundPlayerSeek = 0;
		};

		this.$core.view.$watch('config.soundPlayerVolume', value => {
			player.set_volume(value);
		});

		this.$core.view.$watch('config.soundPlayerLoop', value => {
			player.set_loop(value);
		});

		this.$core.view.$watch('selectionSounds', async selection => {
			const first = selection[0];
			if (!this.$core.view.isBusy && first && selected_file !== first) {
				const base_name = first.substring(first.lastIndexOf('/') + 1) || first.substring(first.lastIndexOf('\\') + 1) || first;
				this.$core.view.soundPlayerTitle = base_name;

				selected_file = first;
				unload_track(this.$core);

				if (this.$core.view.config.soundPlayerAutoPlay)
					play_track(this.$core);
			}
		});

		this.$core.events.on('crash', () => {
			unload_track(this.$core);
			player.destroy();
		});

		await load_sound_list(this.$core);
	}
};
