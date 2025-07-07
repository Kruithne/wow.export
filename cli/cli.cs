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
		IpcManager.RegisterHandler<HandshakeData>("HANDSHAKE", HandleHandshake);

		Log.Info($"IPC mode initialized with *{IpcManager.GetHandlerCount()}* handlers");
		IpcManager.StartListening();
		
		Log.Info("IPC listener has exited");
	}
	
	private static void HandleHandshake(HandshakeData data, IpcBinaryChunk[] binary_chunks)
	{	
		Log.Info($"GUI Versions: Platform *{data.versions.platform}* Electron *{data.versions.electron}* Chrome *{data.versions.chrome}* Node *{data.versions.node}*");
		
		IpcManager.SendMessage("HANDSHAKE_RESPONSE", new HandshakeResponse 
		{ 
			version = GetAssemblyVersion(),
			timestamp = DateTime.UtcNow.ToString("O")
		});
	}
}