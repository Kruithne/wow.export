import log from '../log.js';
import { fs } from '../../views/main/rpc.js';

let changelog_text = '';
let has_loaded = false;

const load_changelog = async () => {
	if (has_loaded)
		return changelog_text;

	try {
		changelog_text = await fs.read_file('CHANGELOG.md');
		has_loaded = true;
	} catch (e) {
		log.write('failed to load changelog: %o', e);
		changelog_text = 'Error loading changelog';
	}

	return changelog_text;
};

export default {
	register() {
		this.registerContextMenuOption('View Recent Changes', 'list.svg');
	},

	template: `
		<div id="changelog">
			<h1>Changelog</h1>
			<component :is="$components.MarkdownContent" id="changelog-text" :content="content"></component>
			<input type="button" value="Go Back" @click="go_back"/>
		</div>
	`,

	data() {
		return {
			content: ''
		};
	},

	methods: {
		go_back() {
			this.$modules.go_to_landing();
		}
	},

	async mounted() {
		this.content = await load_changelog();
	}
};
