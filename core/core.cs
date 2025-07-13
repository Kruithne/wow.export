using System.Reflection;

namespace wow_export;

public partial class Program
{
	public static void Main()
	{
		try
		{
			Log.Info($"Welcome to wow.export core version {GetAssemblyVersionWithBuild()}");
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
	
	public static string GetAssemblyVersionWithBuild()
	{
		string base_version = GetAssemblyVersion();
		
		string? informational_version = Assembly.GetExecutingAssembly()
			.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
		
		if (informational_version != null && informational_version.Contains('+'))
		{
			string build_hash = informational_version.Split('+')[1];
			return $"*{base_version}* (build *{build_hash}*)";
		}
		
		return base_version;
	}
	
	private static void InitializeIpcMode()
	{	
		IpcManager.RegisterHandler<HandshakeRequestHeader>(IpcMessageId.HANDSHAKE_REQUEST, HandleHandshake);

		Log.Info($"IPC mode initialized with *{IpcManager.GetHandlerCount()}* handlers");
		IpcManager.StartListening();
		
		Log.Info("IPC listener has exited");
	}
	
	private static void HandleHandshake(HandshakeRequestHeader request_header)
	{	
		Log.Info($"Client Versions: Platform *{request_header.GetPlatform()}* Electron *{request_header.GetElectronVersion()}* Chrome *{request_header.GetChromeVersion()}* Node *{request_header.GetNodeVersion()}*");
		
		HandshakeResponseHeader response_header = HandshakeResponseHeader.Create(GetAssemblyVersion());
		
		using Stream stdout = Console.OpenStandardOutput();
		IpcManager.SendMessage(stdout, IpcMessageId.HANDSHAKE_RESPONSE, response_header);
	}
}