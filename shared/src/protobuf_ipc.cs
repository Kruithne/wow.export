using System.Diagnostics.CodeAnalysis;
using Google.Protobuf;

namespace wow_export;

public delegate void ProtobufMessageHandler<in T>(T message) where T : IMessage;

public static class ProtobufIpcManager
{
	private static readonly Dictionary<Type, object> _handlers = [];

	public static void RegisterHandler<T>(ProtobufMessageHandler<T> handler) where T : IMessage
	{
		_handlers[typeof(T)] = handler;
	}

	public static void SendMessage<T>(Stream stream, T message) where T : IMessage
	{
		IpcMessage ipc_message = new();
		SetMessageInEnvelope(ipc_message, message);
		
		byte[] message_bytes = ipc_message.ToByteArray();
		byte[] length_bytes = BitConverter.GetBytes((uint)message_bytes.Length);
		
		stream.Write(length_bytes);
		stream.Write(message_bytes);
		stream.Flush();
	}

	public static async Task DispatchMessage(Stream stream)
	{
		byte[] length_bytes = new byte[4];
		await stream.ReadExactlyAsync(length_bytes);
		
		uint message_length = BitConverter.ToUInt32(length_bytes);
		if (message_length == 0)
			return;
			
		byte[] message_bytes = new byte[message_length];
		await stream.ReadExactlyAsync(message_bytes);
		
		IpcMessage ipc_message = IpcMessage.Parser.ParseFrom(message_bytes);
		await DispatchIpcMessage(ipc_message);
	}

	public static void StartListening()
	{
		try
		{
			using Stream stdin = Console.OpenStandardInput();
			while (true)
				DispatchMessage(stdin).Wait();
		}
		catch (Exception)
		{
			// IPC listener error - silently handle
		}
	}

	private static void SetMessageInEnvelope<T>(IpcMessage envelope, T message) where T : IMessage
	{
		switch (message)
		{
			case HandshakeRequest request:
				envelope.HandshakeRequest = request;
				break;
			case HandshakeResponse response:
				envelope.HandshakeResponse = response;
				break;
			case RegionListRequest request:
				envelope.RegionListRequest = request;
				break;
			case RegionListResponse response:
				envelope.RegionListResponse = response;
				break;
			case UpdateApplicationRequest request:
				envelope.UpdateApplicationRequest = request;
				break;
			case UpdateApplicationResponse response:
				envelope.UpdateApplicationResponse = response;
				break;
			default:
				throw new ArgumentException($"Unknown message type: {typeof(T).Name}");
		}
	}

	private static async Task DispatchIpcMessage(IpcMessage ipc_message)
	{
		switch (ipc_message.MessageTypeCase)
		{
			case IpcMessage.MessageTypeOneofCase.HandshakeRequest:
				await DispatchTypedMessage(ipc_message.HandshakeRequest);
				break;
			case IpcMessage.MessageTypeOneofCase.HandshakeResponse:
				await DispatchTypedMessage(ipc_message.HandshakeResponse);
				break;
			case IpcMessage.MessageTypeOneofCase.RegionListRequest:
				await DispatchTypedMessage(ipc_message.RegionListRequest);
				break;
			case IpcMessage.MessageTypeOneofCase.RegionListResponse:
				await DispatchTypedMessage(ipc_message.RegionListResponse);
				break;
			case IpcMessage.MessageTypeOneofCase.UpdateApplicationRequest:
				await DispatchTypedMessage(ipc_message.UpdateApplicationRequest);
				break;
			case IpcMessage.MessageTypeOneofCase.UpdateApplicationResponse:
				await DispatchTypedMessage(ipc_message.UpdateApplicationResponse);
				break;
			case IpcMessage.MessageTypeOneofCase.None:
			default:
				// Unknown message type - silently ignore
				break;
		}
	}

	private static async Task DispatchTypedMessage<T>(T message) where T : IMessage
	{
		await Task.Run(() =>
		{
			if (_handlers.TryGetValue(typeof(T), out object? handler))
			{
				if (handler is ProtobufMessageHandler<T> typed_handler)
					typed_handler(message);
			}
		});
	}
	
	public static void DispatchTypedMessageSync<T>(T message) where T : IMessage
	{
		if (_handlers.TryGetValue(typeof(T), out object? handler))
		{
			if (handler is ProtobufMessageHandler<T> typed_handler)
				typed_handler(message);
		}
	}
}

public static class ProtobufConversion
{
	public static CDNRegionProto ToProto(CDNRegionData data)
	{
		return new CDNRegionProto
		{
			Id = data.id,
			DisplayName = data.display_name,
			PatchHostTemplate = data.patch_host_template,
			RibbitHostTemplate = data.ribbit_host_template
		};
	}

	public static CDNRegionData FromProto(CDNRegionProto proto)
	{
		return CDNRegionData.Create(
			proto.Id,
			proto.DisplayName,
			proto.PatchHostTemplate,
			proto.RibbitHostTemplate
		);
	}

	public static RegionListResponse CreateRegionListResponse(CDNRegionData[] regions)
	{
		RegionListResponse response = new();
		foreach (CDNRegionData region in regions)
		{
			response.Regions.Add(ToProto(region));
		}
		return response;
	}

	public static CDNRegionData[] ExtractRegionsFromResponse(RegionListResponse response)
	{
		return response.Regions.Select(FromProto).ToArray();
	}
}