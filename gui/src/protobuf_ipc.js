const { 
	encodeIpcMessage, decodeIpcMessage
} = require('./proto/messages');

class ProtobufIpcClient {
	constructor() {
		this.handlers = new Map();
		this.buffer = Buffer.alloc(0);
	}
	
	register_handler(message_type, handler) {
		this.handlers.set(message_type, handler);
	}
	
	send_message(cli_process, message, message_type) {
		const ipc_message = {};
		this.set_message_in_envelope(ipc_message, message, message_type);
		
		const message_bytes = encodeIpcMessage(ipc_message);
		const length_buffer = Buffer.alloc(4);
		length_buffer.writeUInt32LE(message_bytes.length, 0);
		
		cli_process.stdin.write(length_buffer);
		cli_process.stdin.write(message_bytes);
	}
	
	send_handshake_request(cli_process, platform, electron_version, chrome_version, node_version) {
		const package_info = require('../package.json');
		const app_version = package_info.version || '1.0.0';
		const gui_version = `gui-${app_version}-electron${electron_version}-node${node_version}-chrome-${chrome_version}-${platform}`;
		const process_name = platform === 'win32' ? 'wow_export.exe' : 'wow_export';
		
		const request = {
			client_version: gui_version,
			process_name: process_name
		};
		
		this.send_message(cli_process, request, 'handshake_request');
	}
	
	send_region_list_request(cli_process) {
		const request = {};
		this.send_message(cli_process, request, 'region_list_request');
	}
	
	send_update_application_request(cli_process) {
		const request = {};
		this.send_message(cli_process, request, 'update_application_request');
	}
	
	handle_stdout_data(data) {
		this.buffer = Buffer.concat([this.buffer, data]);
		
		while (this.buffer.length >= 4) {
			const message_length = this.buffer.readUInt32LE(0);
			
			if (message_length === 0) {
				this.buffer = this.buffer.subarray(4);
				continue;
			}
			
			const total_needed = 4 + message_length;
			if (this.buffer.length < total_needed)
				break;
			
			const message_bytes = this.buffer.subarray(4, 4 + message_length);
			this.buffer = this.buffer.subarray(4 + message_length);
			
			try {
				const ipc_message = decodeIpcMessage(message_bytes);
				this.dispatch_ipc_message(ipc_message);
			} catch (error) {
				console.error('Failed to decode protobuf message:', error);
			}
		}
	}
	
	dispatch_ipc_message(ipc_message) {
		if (ipc_message.handshake_request) {
			this.dispatch_typed_message('handshake_request', ipc_message.handshake_request);
		} else if (ipc_message.handshake_response) {
			this.dispatch_typed_message('handshake_response', ipc_message.handshake_response);
		} else if (ipc_message.region_list_request) {
			this.dispatch_typed_message('region_list_request', ipc_message.region_list_request);
		} else if (ipc_message.region_list_response) {
			this.dispatch_typed_message('region_list_response', ipc_message.region_list_response);
		} else if (ipc_message.update_application_request) {
			this.dispatch_typed_message('update_application_request', ipc_message.update_application_request);
		} else if (ipc_message.update_application_response) {
			this.dispatch_typed_message('update_application_response', ipc_message.update_application_response);
		} else if (ipc_message.update_application_stats) {
			this.dispatch_typed_message('update_application_stats', ipc_message.update_application_stats);
		} else if (ipc_message.update_application_progress) {
			this.dispatch_typed_message('update_application_progress', ipc_message.update_application_progress);
		} else {
			console.error('Unknown message type in IPC message');
		}
	}
	
	dispatch_typed_message(message_type, message) {
		const handler = this.handlers.get(message_type);
		if (handler) {
			handler(message);
		} else {
			console.error(`No handler registered for message type: ${message_type}`);
		}
	}
	
	set_message_in_envelope(envelope, message, message_type) {
		switch (message_type) {
			case 'handshake_request':
				envelope.handshake_request = message;
				break;
			case 'handshake_response':
				envelope.handshake_response = message;
				break;
			case 'region_list_request':
				envelope.region_list_request = message;
				break;
			case 'region_list_response':
				envelope.region_list_response = message;
				break;
			case 'update_application_request':
				envelope.update_application_request = message;
				break;
			case 'update_application_response':
				envelope.update_application_response = message;
				break;
			case 'update_application_stats':
				envelope.update_application_stats = message;
				break;
			case 'update_application_progress':
				envelope.update_application_progress = message;
				break;
			default:
				throw new Error(`Unknown message type: ${message_type}`);
		}
	}
}

function protobuf_region_to_data(proto_region) {
	return {
		id: proto_region.id,
		display_name: proto_region.display_name,
		patch_host_template: proto_region.patch_host_template,
		ribbit_host_template: proto_region.ribbit_host_template
	};
}

function extract_regions_from_response(response) {
	return response.regions.map(protobuf_region_to_data);
}

module.exports = { 
	ProtobufIpcClient,
	extract_regions_from_response 
};