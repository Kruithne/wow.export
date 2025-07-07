using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace wow_export;

public enum IpcMessageType : uint
{
	JSON = 0x4A534F4E,
	CBIN = 0x4342494E
}

[JsonSerializable(typeof(IpcMessage))]
[JsonSerializable(typeof(object))]
[JsonSerializable(typeof(string[]))]
[JsonSerializable(typeof(Dictionary<string, object>))]
[JsonSerializable(typeof(HandshakeResponse))]
internal partial class IpcJsonContext : JsonSerializerContext
{
}

public class IpcMessage
{
	public string id { get; set; } = string.Empty;
	public object? data { get; set; }
	public string[]? cbin { get; set; }
}

public class IpcBinaryChunk
{
	public string uuid { get; set; } = string.Empty;
	public byte[] data { get; set; } = [];
}

public class HandshakeResponse
{
	public string version { get; set; } = string.Empty;
	public string timestamp { get; set; } = string.Empty;
}

public delegate void IpcMessageHandler(IpcMessage message, IpcBinaryChunk[] binary_chunks);

public static class IpcManager
{
	private static readonly Dictionary<string, IpcMessageHandler> _handlers = [];
	private static readonly Dictionary<string, IpcBinaryChunk> _pending_binaries = [];
	private static readonly Dictionary<string, (IpcMessage message, List<string> awaiting_uuids)> _pending_messages = [];

	public static int GetHandlerCount()
	{
		return _handlers.Count;
	}

	public static void RegisterHandler(string message_id, IpcMessageHandler handler)
	{
		_handlers[message_id] = handler;
	}

	public static void SendMessage(string message_id, object? data = null, IpcBinaryChunk[]? binary_chunks = null)
	{
		IpcMessage message = new IpcMessage
		{
			id = message_id,
			data = data
		};

		if (binary_chunks != null && binary_chunks.Length > 0)
		{
			message.cbin = binary_chunks.Select(chunk => chunk.uuid).ToArray();
		}

		string json_string = JsonSerializer.Serialize(message, IpcJsonContext.Default.IpcMessage);
		byte[] json_bytes = Encoding.UTF8.GetBytes(json_string);

		WriteMessage(IpcMessageType.JSON, json_bytes);

		if (binary_chunks != null)
		{
			foreach (IpcBinaryChunk chunk in binary_chunks)
			{
				byte[] uuid_bytes = Encoding.UTF8.GetBytes(chunk.uuid);
				byte[] combined_data = new byte[uuid_bytes.Length + chunk.data.Length];
				Array.Copy(uuid_bytes, 0, combined_data, 0, uuid_bytes.Length);
				Array.Copy(chunk.data, 0, combined_data, uuid_bytes.Length, chunk.data.Length);
				WriteMessage(IpcMessageType.CBIN, combined_data);
			}
		}
	}

	public static void StartListening()
	{
		if (CLIFlags.GetContext() != CLIContext.IPC)
			return;

		try
		{
			using Stream stdin = Console.OpenStandardInput();
			while (true)
				ReadMessage(stdin).Wait();
		}
		catch (Exception ex)
		{
			Log.Error($"IPC listener error: {ex.Message}");
			Log.Error("IPC listener has stopped");
		}
	}

	private static void WriteMessage(IpcMessageType type, byte[] data)
	{
		using Stream stdout = Console.OpenStandardOutput();
		
		byte[] type_bytes = BitConverter.GetBytes((uint)type);
		byte[] length_bytes = BitConverter.GetBytes((uint)data.Length);
		
		stdout.Write(type_bytes);
		stdout.Write(length_bytes);
		stdout.Write(data);
		stdout.Flush();
	}

	private static async Task ReadMessage(Stream stream)
	{
		byte[] header = new byte[8];
		await stream.ReadExactlyAsync(header);

		uint type_raw = BitConverter.ToUInt32(header, 0);
		uint length = BitConverter.ToUInt32(header, 4);
		
		Log.Info($"Received message header: type=0x{type_raw:X8}, length={length}");

		byte[] payload = new byte[length];
		await stream.ReadExactlyAsync(payload);

		IpcMessageType message_type = (IpcMessageType)type_raw;

		switch (message_type)
		{
			case IpcMessageType.JSON:
				HandleJsonMessage(payload);
				break;

			case IpcMessageType.CBIN:
				HandleBinaryMessage(payload);
				break;
				
			default:
				Log.Error($"Unknown IPC message type: {type_raw:X8}");
				break;
		}
	}

	private static void HandleJsonMessage(byte[] payload)
	{
		try
		{
			string json_string = Encoding.UTF8.GetString(payload);
			IpcMessage? message = JsonSerializer.Deserialize(json_string, IpcJsonContext.Default.IpcMessage);

			if (message?.id == null)
			{
				Log.Error("Received JSON message without ID");
				return;
			}

			if (message.cbin == null || message.cbin.Length == 0)
			{
				ProcessMessage(message, []);
			}
			else
			{
				string message_key = Guid.NewGuid().ToString();
				_pending_messages[message_key] = (message, message.cbin.ToList());
				CheckPendingMessage(message_key);
			}
		}
		catch (Exception ex)
		{
			Log.Error($"Error processing JSON message: {ex.Message}");
		}
	}

	private static void HandleBinaryMessage(byte[] payload)
	{
		try
		{
			string uuid = Encoding.UTF8.GetString(payload, 0, 36);
			byte[] binary_data = payload[36..];

			IpcBinaryChunk chunk = new IpcBinaryChunk
			{
				uuid = uuid,
				data = binary_data
			};

			_pending_binaries[uuid] = chunk;
			CheckAllPendingMessages();
		}
		catch (Exception ex)
		{
			Log.Error($"Error processing binary message: {ex.Message}");
		}
	}

	private static void CheckAllPendingMessages()
	{
		foreach (string message_key in _pending_messages.Keys.ToArray())
		{
			CheckPendingMessage(message_key);
		}
	}

	private static void CheckPendingMessage(string message_key)
	{
		if (!_pending_messages.TryGetValue(message_key, out var pending))
			return;

		(IpcMessage message, List<string> awaiting_uuids) = pending;

		awaiting_uuids.RemoveAll(_pending_binaries.ContainsKey);

		if (awaiting_uuids.Count == 0)
		{
			IpcBinaryChunk[] binary_chunks = message.cbin?
				.Where(_pending_binaries.ContainsKey)
				.Select(uuid => _pending_binaries[uuid])
				.ToArray() ?? [];

			ProcessMessage(message, binary_chunks);

			if (message.cbin != null)
			{
				foreach (string uuid in message.cbin)
					_pending_binaries.Remove(uuid);
			}

			_pending_messages.Remove(message_key);
		}
	}

	private static void ProcessMessage(IpcMessage message, IpcBinaryChunk[] binary_chunks)
	{
		if (_handlers.TryGetValue(message.id, out IpcMessageHandler? handler))
		{
			try
			{
				handler(message, binary_chunks);
			}
			catch (Exception ex)
			{
				Log.Error($"Error in message handler for '{message.id}': {ex.Message}");
			}
		}
		else
		{
			Log.Error($"No handler registered for message ID: {message.id}");
		}
	}
}