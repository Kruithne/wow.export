using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;
using System.Text;

namespace wow_export;

public enum IpcMessageId : uint
{
	HANDSHAKE_REQUEST = 1,
	HANDSHAKE_RESPONSE = 2,
}

[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct HandshakeRequestHeader
{
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 64)]
	public byte[] platform;
	
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
	public byte[] electron_version;
	
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
	public byte[] chrome_version;
	
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
	public byte[] node_version;
	
	public long timestamp;
	
	public static HandshakeRequestHeader Create(string platform_str, string electron_str, string chrome_str, string node_str)
	{
		HandshakeRequestHeader header = new()
		{
			platform = new byte[64],
			electron_version = new byte[32],
			chrome_version = new byte[32],
			node_version = new byte[32],
			timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
		};
		
		IpcStructHelper.CopyStringToByteArray(platform_str, header.platform);
		IpcStructHelper.CopyStringToByteArray(electron_str, header.electron_version);
		IpcStructHelper.CopyStringToByteArray(chrome_str, header.chrome_version);
		IpcStructHelper.CopyStringToByteArray(node_str, header.node_version);
		
		return header;
	}
	
	public string GetPlatform() => IpcStructHelper.GetStringFromByteArray(platform);
	public string GetElectronVersion() => IpcStructHelper.GetStringFromByteArray(electron_version);
	public string GetChromeVersion() => IpcStructHelper.GetStringFromByteArray(chrome_version);
	public string GetNodeVersion() => IpcStructHelper.GetStringFromByteArray(node_version);
}

[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct HandshakeResponseHeader
{
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
	public byte[] version;
	
	public long timestamp;
	
	public static HandshakeResponseHeader Create(string version_str)
	{
		HandshakeResponseHeader header = new()
		{
			version = new byte[32],
			timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
		};
		
		IpcStructHelper.CopyStringToByteArray(version_str, header.version);
		
		return header;
	}
	
	public string GetVersion() => IpcStructHelper.GetStringFromByteArray(version);
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

public delegate void IpcBinaryMessageHandler<T>(T header) where T : struct;

public static class IpcManager
{
	private static readonly Dictionary<IpcMessageId, Delegate> _handlers = [];

	public static int GetHandlerCount()
	{
		return _handlers.Count;
	}

	public static void RegisterHandler<T>(IpcMessageId message_id, IpcBinaryMessageHandler<T> handler) where T : struct
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

	public static async Task ReadAndDispatchMessage(Stream stream)
	{
		byte[] id_bytes = new byte[4];
		await stream.ReadExactlyAsync(id_bytes);
		
		uint message_id_raw = BitConverter.ToUInt32(id_bytes);
		IpcMessageId message_id = (IpcMessageId)message_id_raw;
		
		if (!_handlers.TryGetValue(message_id, out Delegate? handler))
		{
			Log.Error($"No handler registered for message ID: {message_id}");
			return;
		}
		
		switch (message_id)
		{
			case IpcMessageId.HANDSHAKE_REQUEST:
				{
					HandshakeRequestHeader header = await ReadStruct<HandshakeRequestHeader>(stream);
					((IpcBinaryMessageHandler<HandshakeRequestHeader>)handler)(header);
				}
				break;
				
			case IpcMessageId.HANDSHAKE_RESPONSE:
				{
					HandshakeResponseHeader header = await ReadStruct<HandshakeResponseHeader>(stream);
					((IpcBinaryMessageHandler<HandshakeResponseHeader>)handler)(header);
				}
				break;
				
			default:
				Log.Error($"Unknown message ID: {message_id}");
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
			Log.Error($"IPC listener error: {ex.Message}");
			Log.Error("IPC listener has stopped");
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