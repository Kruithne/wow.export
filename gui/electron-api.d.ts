interface ElectronApi {
	get_app_version(): Promise<string>;
	send_cli_message(message_id: string, data: any): Promise<any>;
	on_cli_handshake(callback: (event: any, ...args: any[]) => void): void;
	on_cli_spawn_error(callback: (event: any, ...args: any[]) => void): void;
	platform: string;
	versions: {
		node: string;
		chrome: string;
		electron: string;
	};
}

declare global {
	interface Window {
		electron_api: ElectronApi;
	}
}

export {};