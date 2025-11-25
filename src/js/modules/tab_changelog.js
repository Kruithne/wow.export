const fsp = require('fs').promises;
const log = require('../log');

const BUILD_RELEASE = typeof process.env.BUILD_RELEASE !== 'undefined';

let changelog_text = '';
let has_loaded = false;

const load_changelog = async () => {
	if (has_loaded)
		return changelog_text;

	try {
		const changelog_path = BUILD_RELEASE ? './src/CHANGELOG.md' : '../../CHANGELOG.md';
		changelog_text = await fsp.readFile(changelog_path, 'utf8');
		has_loaded = true;
	} catch (e) {
		log.write('failed to load changelog: %o', e);
		changelog_text = 'Error loading changelog';
	}

	return changelog_text;
};

module.exports = {
	register() {
		this.registerContextMenuOption('View Recent Changes', 'list.svg');
	},

	template: `
		<div id="changelog">
			<h1>Changelog</h1>
			<markdown-content id="changelog-text" :content="content"></markdown-content>
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
			this.$modules.tab_home.setActive();
		}
	},

	async mounted() {
		this.content = await load_changelog();
	}
};
