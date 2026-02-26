export default {
	template: `
		<div class="module-test-a">
			<h2>Module Test A</h2>
			<p>Counter: {{ counter }}</p>
			<button @click="increment">Increment</button>
			<button @click="switch_module">Switch to Module B</button>
		</div>
	`,

	data() {
		return {
			counter: 0
		};
	},

	methods: {
		increment() {
			this.counter++;
		},

		switch_module() {
			this.$modules.module_test_b.setActive();
		}
	},

	mounted() {
		console.log('module_test_a mounted');
	},

	unmounted() {
		console.log('module_test_a unmounted');
	}
};
