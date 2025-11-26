const fsp = require('fs').promises;
const path = require('path');
const log = require('../log');

const help_articles = [];
let help_loaded = false;

const load_help_docs = async (core) => {
	if (help_loaded)
		return;

	core.showLoadingScreen(1);

	try {
		await core.progressLoadingScreen('loading help documents...');

		const help_dir = './src/help_docs';
		log.write('loading help docs from: %s', help_dir);

		const files = await fsp.readdir(help_dir);
		const md_files = files.filter(f => f.endsWith('.md'));
		log.write('found %d markdown files', md_files.length);

		for (const file of md_files) {
			const file_path = path.join(help_dir, file);
			const content = await fsp.readFile(file_path, 'utf8');
			const lines = content.split('\n');

			if (lines.length < 2)
				continue;

			const tag_line = lines[0].trim();
			if (!tag_line.startsWith('!'))
				continue;

			const tags = tag_line.substring(1).trim().split(/\s+/).map(t => t.toLowerCase());
			const title_line = lines[1].trim();

			if (!title_line.startsWith('#'))
				continue;

			const title = title_line.substring(1).trim();
			const body = lines.slice(1).join('\n');

			const kb_match = title.match(/^(KB\d+):\s*(.+)/);
			const kb_id = kb_match ? kb_match[1] : null;
			const title_text = kb_match ? kb_match[2] : title;

			help_articles.push({ tags, title: title_text, kb_id, body });
			log.write('loaded help article: %s', title_text);
		}

		log.write('loaded %d help articles total', help_articles.length);
		help_loaded = true;
		core.hideLoadingScreen();
	} catch (e) {
		log.write('failed to load help documents: %s', e.message);
		core.hideLoadingScreen();
		core.setToast('error', 'failed to load help documents');
	}
};

const filter_articles = (search) => {
	if (!search || search.trim() === '')
		return help_articles;

	const keywords = search.toLowerCase().trim().split(/\s+/);
	const scored = help_articles.map(article => {
		const has_default = article.tags.includes('default');
		let score = 0;

		for (const kw of keywords) {
			if (article.kb_id && article.kb_id.toLowerCase() === kw)
				score += 3;
			else if (article.kb_id && article.kb_id.toLowerCase().includes(kw))
				score += 2;

			for (const tag of article.tags) {
				if (tag === kw)
					score += 2;
				else if (tag.includes(kw))
					score += 1;
			}
		}

		return { article, matched: score, has_default };
	}).filter(s => s.matched > 0 || s.has_default);

	scored.sort((a, b) => b.matched - a.matched);
	return scored.map(s => s.article);
};

let filter_timeout = null;

module.exports = {
	register() {
		this.registerContextMenuOption('Help', 'help.svg');
	},

	template: `
		<div id="help-screen">
			<div class="help-list-container">
				<h1>Help</h1>
				<div class="filter">
					<input type="text" v-model="search_query" placeholder="Search help articles..."/>
				</div>
				<div id="help-articles">
					<div v-for="article in filtered_articles" @click="selected_article = article" class="help-article-item" :class="{ selected: selected_article === article }">
						<div class="help-article-title">{{ article.title }}</div>
						<div class="help-article-tags">
							<span v-if="article.kb_id" class="help-kb-id">{{ article.kb_id }}</span>
							<span>{{ article.tags.join(', ') }}</span>
						</div>
					</div>
				</div>
			</div>
			<div class="help-article-container">
				<component :is="$components.MarkdownContent" v-if="selected_article" :content="selected_article.body"></component>
				<div v-else class="help-placeholder">Select an article to view</div>
			</div>
			<input type="button" value="Go Back" @click="go_back"/>
		</div>
	`,

	data() {
		return {
			search_query: '',
			filtered_articles: [],
			selected_article: null
		};
	},

	methods: {
		go_back() {
			this.$modules.go_to_landing();
		},

		debounced_filter(search) {
			clearTimeout(filter_timeout);
			filter_timeout = setTimeout(() => {
				this.filtered_articles = filter_articles(search);
			}, 300);
		}
	},

	watch: {
		search_query(value) {
			this.debounced_filter(value);
		}
	},

	async mounted() {
		await load_help_docs(this.$core);

		this.filtered_articles = help_articles;

		const kb002 = help_articles.find(a => a.kb_id === 'KB002');
		this.selected_article = kb002 || null;
	}
};
