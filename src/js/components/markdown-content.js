/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

module.exports = {
	props: ['content'],

	data: function() {
		return {
			scroll_pos: 0,
			widget_height: 0,
			is_dragging: false
		}
	},

	mounted: function() {
		this.onMouseMove = e => this.moveMouse(e);
		this.onMouseUp = e => this.stopMouse(e);

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(this.$refs.root);

		this.$nextTick(() => this.update_scrollbar());
	},

	beforeUnmount: function() {
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);

		this.observer.disconnect();
	},

	computed: {
		htmlContent: function() {
			if (!this.content)
				return '';

			return this.parseMarkdown(this.content);
		}
	},

	watch: {
		content: function() {
			this.scroll_pos = 0;
			this.$nextTick(() => this.update_scrollbar());
		}
	},

	methods: {
		resize: function() {
			this.update_scrollbar();
		},

		update_scrollbar: function() {
			const container = this.$refs.root;
			if (!container)
				return;

			const viewport_height = container.clientHeight;
			const content_height = container.scrollHeight;
			const scrollable_height = Math.max(0, content_height - viewport_height);

			const ratio = viewport_height / content_height;
			this.widget_height = Math.max(30, viewport_height * ratio);

			this.scroll_pos = Math.min(scrollable_height, Math.max(0, this.scroll_pos));
		},

		get_widget_top: function() {
			const container = this.$refs.root;
			if (!container)
				return 0;

			const viewport_height = container.clientHeight;
			const content_height = container.scrollHeight;
			const scrollable_height = Math.max(0, content_height - viewport_height);

			if (scrollable_height === 0)
				return 0;

			const track_height = viewport_height;
			const widget_range = track_height - this.widget_height;

			return (this.scroll_pos / scrollable_height) * widget_range;
		},

		startMouse: function(e) {
			this.drag_start_y = e.clientY;
			this.drag_start_top = this.get_widget_top();
			this.is_dragging = true;
		},

		moveMouse: function(e) {
			if (!this.is_dragging)
				return;

			const container = this.$refs.root;
			if (!container)
				return;

			const viewport_height = container.clientHeight;
			const content_height = container.scrollHeight;
			const scrollable_height = Math.max(0, content_height - viewport_height);

			if (scrollable_height === 0)
				return;

			const delta_y = e.clientY - this.drag_start_y;
			const widget_top = this.drag_start_top + delta_y;

			const widget_range = viewport_height - this.widget_height;
			const clamped_top = Math.min(widget_range, Math.max(0, widget_top));

			this.scroll_pos = (clamped_top / widget_range) * scrollable_height;
		},

		stopMouse: function() {
			this.is_dragging = false;
		},

		wheelMouse: function(e) {
			const container = this.$refs.root;
			if (!container)
				return;

			const content_height = container.scrollHeight;
			const viewport_height = container.clientHeight;
			const scrollable_height = Math.max(0, content_height - viewport_height);

			if (scrollable_height === 0)
				return;

			const delta = e.deltaY > 0 ? 1 : -1;
			this.scroll_pos += delta * 30;
			this.update_scrollbar();
		},

		parseMarkdown: function(text) {
			const lines = text.split('\n');
			const html = [];
			let in_list = false;
			let in_code = false;
			let code_block = [];

			for (let line of lines) {
				if (line.startsWith('```')) {
					if (in_code) {
						html.push('<pre><code>' + this.escapeHtml(code_block.join('\n')) + '</code></pre>');
						code_block = [];
						in_code = false;
					} else {
						in_code = true;
					}
					continue;
				}

				if (in_code) {
					code_block.push(line);
					continue;
				}

				// headers
				if (line.startsWith('### ')) {
					html.push('<h3>' + this.parseInline(line.substring(4)) + '</h3>');
				} else if (line.startsWith('## ')) {
					html.push('<h2>' + this.parseInline(line.substring(3)) + '</h2>');
				} else if (line.startsWith('# ')) {
					html.push('<h1>' + this.parseInline(line.substring(2)) + '</h1>');
				}
				// lists
				else if (line.match(/^[\*\-\+]\s/)) {
					if (!in_list) {
						html.push('<ul>');
						in_list = true;
					}
					html.push('<li>' + this.parseInline(line.substring(2)) + '</li>');
				} else {
					if (in_list) {
						html.push('</ul>');
						in_list = false;
					}

					if (line.trim().length > 0)
						html.push('<p>' + this.parseInline(line) + '</p>');
					else
						html.push('<br/>');
				}
			}

			if (in_list)
				html.push('</ul>');

			if (in_code && code_block.length > 0)
				html.push('<pre><code>' + this.escapeHtml(code_block.join('\n')) + '</code></pre>');

			return html.join('\n');
		},

		parseInline: function(text) {
			text = this.escapeHtml(text);

			// images
			text = text.replace(/!\[(.+?)\]\((.+?)\)/g, (match, alt, src) => {
				if (src.startsWith('./'))
					src = src.substring(2);

				if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:'))
					src = 'help_docs/' + src;

				return '<img src="' + src + '" alt="' + alt + '">';
			});

			// bold
			text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
			text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

			// italic
			text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

			// code
			text = text.replace(/`(.+?)`/g, '<code>$1</code>');

			// links
			text = text.replace(/\[(.+?)\]\((.+?)\)/g, (match, label, href) => {
				if (href.startsWith('::KB'))
					return '<a data-kb-link="' + href.substring(2) + '">' + label + '</a>';

				return '<a data-external="' + href + '">' + label + '</a>';
			});

			return text;
		},

		escapeHtml: function(text) {
			const map = {
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#039;'
			};
			return text.replace(/[&<>"']/g, m => map[m]);
		}
	},

	template: `<div ref="root" class="markdown-content" @wheel="wheelMouse">
		<div ref="content" class="markdown-content-inner" v-html="htmlContent" :style="{ transform: 'translateY(' + (-scroll_pos) + 'px)' }"></div>
		<div class="vscroller" ref="scroller" @mousedown="startMouse" :class="{ using: is_dragging }" :style="{ top: get_widget_top() + 'px', height: widget_height + 'px' }"><div></div></div>
	</div>`
};
