export default {
	template: `
		<div class="module-test-b">
			<h2>Module Test B</h2>
			<p>Message: {{ message }}</p>
			<input v-model="message" />
			<p>Dev Mode: {{ $core.view.isDev }}</p>
			<p>Busy State: {{ $core.view.isBusy }}</p>
			<p>CASC Loaded: {{ $core.view.casc !== null }}</p>
			<button @click="switch_module">Switch to Module A</button>
			<button @click="reload_self">Reload Module B</button>
			<button @click="show_toast">Show Toast</button>
		</div>
	`,

	data() {
		return {
			message: 'Hello Thrall'
		};
	},

	methods: {
		switch_module() {
			this.$modules.module_test_a.setActive();
		},

		reload_self() {
			this.$modules.module_test_b.reload();
		},

		show_toast() {
			this.$core.setToast('info', 'test toast from module b');
		}
	},

	mounted() {
		console.log('module_test_b mounted');
	},

	unmounted() {
		console.log('module_test_b unmounted');
	}
};
