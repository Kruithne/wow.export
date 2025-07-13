using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;
using System.Text;

namespace wow_export;

public enum IpcMessageId : uint
{
	HANDSHAKE_REQUEST = 1,
	HANDSHAKE_RESPONSE = 2,
}

public struct HandshakeRequestMessage
{
	public string client_version;
	
	public static HandshakeRequestMessage Create(string client_version_str)
	{
		return new HandshakeRequestMessage
		{
			client_version = client_version_str
		};
	}
}

public struct HandshakeResponseMessage
{
	public string core_version;
	
	public static HandshakeResponseMessage Create(string core_version_str)
	{
		return new HandshakeResponseMessage
		{
			core_version = core_version_str
		};
	}
}

public static class IpcStructHelper
{
	public static void CopyStringToByteArray(string str, byte[] array)
	{
		if (string.IsNullOrEmpty(str))
			return;
			
		byte[] str_bytes = Encoding.UTF8.GetBytes(str);
		int copy_length = Math.Min(str_bytes.Length, array.Length - 1);
		Array.Copy(str_bytes, array, copy_length);
		array[copy_length] = 0; // null terminator
	}
	
	public static string GetStringFromByteArray(byte[] array)
	{
		int null_index = Array.IndexOf(array, (byte)0);
		int length = null_index >= 0 ? null_index : array.Length;
		return Encoding.UTF8.GetString(array, 0, length);
	}
}

public static class IpcStringHelper
{
	public static void WriteString(Stream stream, string str)
	{
		byte[] str_bytes = string.IsNullOrEmpty(str) ? [] : Encoding.UTF8.GetBytes(str);
		byte[] length_bytes = BitConverter.GetBytes((uint)str_bytes.Length);
		
		stream.Write(length_bytes);
		if (str_bytes.Length > 0)
			stream.Write(str_bytes);
	}
	
	public static async Task<string> ReadStringAsync(Stream stream)
	{
		byte[] length_bytes = new byte[4];
		await stream.ReadExactlyAsync(length_bytes);
		
		uint length = BitConverter.ToUInt32(length_bytes);
		if (length == 0)
			return string.Empty;
			
		byte[] str_bytes = new byte[length];
		await stream.ReadExactlyAsync(str_bytes);
		
		return Encoding.UTF8.GetString(str_bytes);
	}
	
	public static byte[] GetStringBytes(string str)
	{
		byte[] str_bytes = string.IsNullOrEmpty(str) ? [] : Encoding.UTF8.GetBytes(str);
		byte[] length_bytes = BitConverter.GetBytes((uint)str_bytes.Length);
		
		byte[] result = new byte[4 + str_bytes.Length];
		Array.Copy(length_bytes, 0, result, 0, 4);
		if (str_bytes.Length > 0)
			Array.Copy(str_bytes, 0, result, 4, str_bytes.Length);
			
		return result;
	}
}

public delegate void IpcBinaryMessageHandler<T>(T header) where T : struct;
public delegate void IpcStringMessageHandler(string message_data);

public static class IpcManager
{
	private static readonly Dictionary<IpcMessageId, Delegate> _handlers = [];

	public static void RegisterHandler<T>(IpcMessageId message_id, IpcBinaryMessageHandler<T> handler) where T : struct
	{
		_handlers[message_id] = handler;
	}
	
	public static void RegisterStringHandler(IpcMessageId message_id, IpcStringMessageHandler handler)
	{
		_handlers[message_id] = handler;
	}

	public static void SendMessage<T>(Stream stream, IpcMessageId message_id, T header) where T : struct
	{
		byte[] id_bytes = BitConverter.GetBytes((uint)message_id);
		byte[] header_bytes = StructToBytes(header);
		
		stream.Write(id_bytes);
		stream.Write(header_bytes);
		stream.Flush();
	}
	
	public static void SendStringMessage(Stream stream, IpcMessageId message_id, string message_data)
	{
		byte[] id_bytes = BitConverter.GetBytes((uint)message_id);
		
		stream.Write(id_bytes);
		IpcStringHelper.WriteString(stream, message_data);
		stream.Flush();
	}

	public static async Task ReadAndDispatchMessage(Stream stream)
	{
		byte[] id_bytes = new byte[4];
		await stream.ReadExactlyAsync(id_bytes);
		
		uint message_id_raw = BitConverter.ToUInt32(id_bytes);
		IpcMessageId message_id = (IpcMessageId)message_id_raw;
		
		if (!_handlers.TryGetValue(message_id, out Delegate? handler))
		{
			Log.Write($"No handler registered for message ID: {message_id}");
			return;
		}
		
		switch (message_id)
		{
			case IpcMessageId.HANDSHAKE_REQUEST:
				{
					string client_version = await IpcStringHelper.ReadStringAsync(stream);
					((IpcStringMessageHandler)handler)(client_version);
				}
				break;
				
			case IpcMessageId.HANDSHAKE_RESPONSE:
				{
					string core_version = await IpcStringHelper.ReadStringAsync(stream);
					((IpcStringMessageHandler)handler)(core_version);
				}
				break;
				
			default:
				Log.Write($"Unknown message ID: {message_id}");
				break;
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
				ReadAndDispatchMessage(stdin).Wait();
		}
		catch (Exception ex)
		{
			Log.Write($"IPC listener error: {ex.Message}");
			Log.Write("IPC listener has stopped");
		}
	}

	private static async Task<T> ReadStruct<[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors | DynamicallyAccessedMemberTypes.NonPublicConstructors)] T>(Stream stream) where T : struct
	{
		int size = Marshal.SizeOf<T>();
		byte[] bytes = new byte[size];
		await stream.ReadExactlyAsync(bytes);
		return BytesToStruct<T>(bytes);
	}

	private static byte[] StructToBytes<T>(T structure) where T : struct
	{
		int size = Marshal.SizeOf<T>();
		byte[] bytes = new byte[size];
		
		IntPtr ptr = Marshal.AllocHGlobal(size);
		try
		{
			Marshal.StructureToPtr(structure, ptr, false);
			Marshal.Copy(ptr, bytes, 0, size);
		}
		finally
		{
			Marshal.FreeHGlobal(ptr);
		}
		
		return bytes;
	}

	private static T BytesToStruct<[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors | DynamicallyAccessedMemberTypes.NonPublicConstructors)] T>(byte[] bytes) where T : struct
	{
		int size = Marshal.SizeOf<T>();
		
		if (bytes.Length != size)
			throw new ArgumentException($"Byte array size {bytes.Length} does not match struct size {size}");
		
		IntPtr ptr = Marshal.AllocHGlobal(size);
		try
		{
			Marshal.Copy(bytes, 0, ptr, size);
			return Marshal.PtrToStructure<T>(ptr);
		}
		finally
		{
			Marshal.FreeHGlobal(ptr);
		}
	}
}