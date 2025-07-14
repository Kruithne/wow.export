using System.Diagnostics;

namespace wow_export;

public class CliIpcClient(Process process)
{
	private readonly Process _process = process;
	private readonly Dictionary<IpcMessageId, IpcMessageHandler> _handlers = [];

	public void RegisterHandler(IpcMessageId message_id, IpcMessageHandler handler)
	{
		_handlers[message_id] = handler;
	}

	public void SendMessage<T>(IpcMessageId message_id, T header) where T : struct
	{
		Stream stdin = _process.StandardInput.BaseStream;
		IpcManager.SendMessage(stdin, message_id, header);
	}
	
	public void SendStringMessage(IpcMessageId message_id, string message_data)
	{
		Stream stdin = _process.StandardInput.BaseStream;
		IpcManager.SendStringMessage(stdin, message_id, message_data);
	}
	
	public void SendArrayMessage<T>(IpcMessageId message_id, T[] array) where T : struct
	{
		Stream stdin = _process.StandardInput.BaseStream;
		IpcManager.SendArrayMessage(stdin, message_id, array);
	}
	
	public void SendEmptyMessage(IpcMessageId message_id)
	{
		Stream stdin = _process.StandardInput.BaseStream;
		IpcManager.SendEmptyMessage(stdin, message_id);
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
		byte[] id_bytes = new byte[4];
		await stream.ReadExactlyAsync(id_bytes);
		
		uint message_id_raw = BitConverter.ToUInt32(id_bytes);
		IpcMessageId message_id = (IpcMessageId)message_id_raw;
		
		if (!_handlers.TryGetValue(message_id, out IpcMessageHandler? handler))
		{
			Log.Error($"No handler registered for message ID: {message_id}");
			return;
		}
		
		IPCMessageReader reader = new(stream);
		handler(reader);
	}

}