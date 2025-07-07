using System.Reflection;
using System.Text.Json;

namespace wow_export;

public class Program
{
	public static void Main()
	{
		try
		{
			Log.Info($"Welcome to wow.export version *{GetAssemblyVersion()}*");
			Log.Info("Report any issues at *https://github.com/Kruithne/wow.export/issues*");
			Log.Blank();
			
			if (CLIFlags.Has(CLIFlag.HELP))
			{
				CLIFlags.PrintHelp();
				return;
			}
			
			if (CLIFlags.GetContext() == CLIContext.IPC)
			{
				InitializeIpcMode();
				return;
			}
		}
		catch (Exception ex)
		{
			Log.Blank();
			Log.Error("A *fatal* error has occurred which has caused wow.export to *crash*");
			Log.Error("Considering reporting this error at *https://github.com/Kruithne/wow.export/issues*");
			Log.Blank();

			string error_code = ex is InternalError internal_error ? internal_error.ErrorCode : "unknown";
			Log.Error($"*{ex.GetType().Name}*: {ex.Message} (*{error_code}*)");

			Error.CreateCrashDump(ex);

			Log.Blank();
			return;
		}
	}
	
	public static string GetAssemblyVersion()
	{
		Version? version = Assembly.GetExecutingAssembly().GetName().Version;

		if (version == null)
			throw new InternalError("Assembly version is not available.");

		return version.ToString(3);
	}
	
	private static void InitializeIpcMode()
	{	
		IpcManager.RegisterHandler("HANDSHAKE", HandleHandshake);

		Log.Info($"IPC mode initialized with *{IpcManager.GetHandlerCount()}* handlers");
		IpcManager.StartListening();
		
		Log.Info("IPC listener has exited");
	}
	
	private static void HandleHandshake(IpcMessage message, IpcBinaryChunk[] binary_chunks)
	{	
		if (message.data != null)
		{
			string data_string = message.data.ToString() ?? "null";
			Log.Info($"Handshake data: *{data_string}*");
			
			try
			{
				using JsonDocument doc = JsonDocument.Parse(data_string);
				if (doc.RootElement.TryGetProperty("versions", out JsonElement versions))
				{
					string platform = versions.TryGetProperty("platform", out JsonElement platformElement) ? platformElement.GetString() ?? "unknown" : "unknown";
					string electron = versions.TryGetProperty("electron", out JsonElement electronElement) ? electronElement.GetString() ?? "unknown" : "unknown";
					string chrome = versions.TryGetProperty("chrome", out JsonElement chromeElement) ? chromeElement.GetString() ?? "unknown" : "unknown";
					string node = versions.TryGetProperty("node", out JsonElement nodeElement) ? nodeElement.GetString() ?? "unknown" : "unknown";
					
					Log.Info($"GUI Versions: Platform *{platform}* Electron *{electron}* Chrome *{chrome}* Node *{node}*");
				}
			}
			catch (Exception ex)
			{
				Log.Error($"Failed to parse version information: {ex.Message}");
			}
		}
		
		IpcManager.SendMessage("HANDSHAKE_RESPONSE", new HandshakeResponse 
		{ 
			version = GetAssemblyVersion(),
			timestamp = DateTime.UtcNow.ToString("O")
		});
	}
}