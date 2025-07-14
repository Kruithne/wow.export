import { createApp } from './node_modules/vue/dist/vue.esm-browser.prod.js';

createApp({
	data() {
		return {
			app_version: 'Loading...',
			system_info: {
				platform: 'Loading...',
				node_version: 'Loading...',
				chrome_version: 'Loading...',
				electron_version: 'Loading...'
			},
			cli_status: {
				message: 'Connecting to Core...',
				color: 'orange'
			}
		};
	},

	async mounted() {
		await this.load_system_info();
		this.setup_cli_communication();
	},

	methods: {
		async load_system_info() {
			try {
				const version = await window.electron_api.get_app_version();
				this.app_version = `v${version}`;
				document.title = `wow.export ${this.app_version}`;
				
				this.system_info.platform = window.electron_api.platform;
				this.system_info.node_version = window.electron_api.versions.node;
				this.system_info.chrome_version = window.electron_api.versions.chrome;
				this.system_info.electron_version = window.electron_api.versions.electron;
			} catch (error) {
				console.error('Error loading system info:', error);
				this.app_version = 'Error loading version';
				document.title = 'wow.export';
			}
		},
		
		setup_cli_communication() {
			window.electron_api.on_cli_handshake((_, data) => {
				this.cli_status.message = `Core Connected - Version: ${data.version}, Time: ${data.timestamp}`;
				this.cli_status.color = 'green';
			});
			
			window.electron_api.on_cli_spawn_error((_, error_message) => {
				console.error('Core spawn error:', error_message);
				this.cli_status.message = `Core Error: ${error_message}`;
				this.cli_status.color = 'red';
			});
		}
	}
}).mount('#app');