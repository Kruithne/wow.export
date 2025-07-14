using System.Diagnostics;
using Google.Protobuf;

namespace wow_export;

public class CliIpcClient(Process process)
{
	private readonly Process _process = process;
	private readonly Dictionary<Type, object> _handlers = [];

	public void RegisterHandler<T>(ProtobufMessageHandler<T> handler) where T : IMessage
	{
		_handlers[typeof(T)] = handler;
	}

	public void SendMessage<T>(T message) where T : IMessage
	{
		Stream stdin = _process.StandardInput.BaseStream;
		ProtobufIpcManager.SendMessage(stdin, message);
	}

	public async Task StartListening()
	{
		try
		{
			using Stream stdout = _process.StandardOutput.BaseStream;
			while (!_process.HasExited)
			{
				await DispatchMessage(stdout);
			}
		}
		catch (Exception ex)
		{
			Log.Error($"IPC client listener error: {ex.Message}");
		}
	}
	
	private async Task DispatchMessage(Stream stream)
	{
		byte[] length_bytes = new byte[4];
		await stream.ReadExactlyAsync(length_bytes);
		
		uint message_length = BitConverter.ToUInt32(length_bytes);
		if (message_length == 0)
			return;
			
		byte[] message_bytes = new byte[message_length];
		await stream.ReadExactlyAsync(message_bytes);
		
		IpcMessage ipc_message = IpcMessage.Parser.ParseFrom(message_bytes);
		DispatchIpcMessage(ipc_message);
	}
	
	private void DispatchIpcMessage(IpcMessage ipc_message)
	{
		switch (ipc_message.MessageTypeCase)
		{
			case IpcMessage.MessageTypeOneofCase.HandshakeRequest:
				DispatchTypedMessage(ipc_message.HandshakeRequest);
				break;
			case IpcMessage.MessageTypeOneofCase.HandshakeResponse:
				DispatchTypedMessage(ipc_message.HandshakeResponse);
				break;
			case IpcMessage.MessageTypeOneofCase.RegionListRequest:
				DispatchTypedMessage(ipc_message.RegionListRequest);
				break;
			case IpcMessage.MessageTypeOneofCase.RegionListResponse:
				DispatchTypedMessage(ipc_message.RegionListResponse);
				break;
			case IpcMessage.MessageTypeOneofCase.None:
			default:
				// Unknown message type - silently ignore
				break;
		}
	}
	
	private void DispatchTypedMessage<T>(T message) where T : IMessage
	{
		if (_handlers.TryGetValue(typeof(T), out object? handler))
		{
			if (handler is ProtobufMessageHandler<T> typed_handler)
				typed_handler(message);
		}
	}
}