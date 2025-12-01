const showcases = require('../showcase.json');

const BASE_LAYERS = [
	{
		image: './images/logo.png',
		size: '50px',
		position: 'bottom 10px right 10px'
	}
];

function get_random_index() {
	return Math.floor(Math.random() * showcases.length);
}

function build_background_style(showcase) {
	const layers = [...BASE_LAYERS, ...showcase.layers];

	const images = layers.map(l => `url(${l.image})`).join(', ');
	const sizes = layers.map(l => l.size).join(', ');
	const positions = layers.map(l => l.position).join(', ');
	const repeats = layers.map(() => 'no-repeat').join(', ');

	return {
		backgroundImage: images,
		backgroundSize: sizes,
		backgroundPosition: positions,
		backgroundRepeat: repeats
	};
}

module.exports = {
	template: `
		<h1 id="home-showcase-header">Made with wow.export</h1>
		<a id="home-showcase" :data-external="current.link" :style="background_style">
			<video v-if="current.video" :src="current.video" autoplay loop muted playsinline></video>
			<span v-if="current.title" class="showcase-title">{{ current.title }}</span>
		</a>
		<div id="home-showcase-links">
			<a @click="refresh">Refresh</a>
			<a data-kb-link="KB011">Feedback</a>
		</div>
	`,

	data() {
		return {
			index: get_random_index()
		};
	},

	computed: {
		current() {
			return showcases[this.index];
		},

		background_style() {
			return build_background_style(this.current);
		}
	},

	methods: {
		refresh() {
			this.index = (this.index + 1) % showcases.length;
		}
	}
};
