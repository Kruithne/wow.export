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
	
	public static string GetAssemblyBuildHash()
	{
		string? informational_version = Assembly.GetExecutingAssembly()
			.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
		
		if (informational_version != null && informational_version.Contains('+'))
			return informational_version.Split('+')[1];
		
		return string.Empty;
	}
	
	public static string GetCoreVersionString()
	{
		string base_version = GetAssemblyVersion();
		string build_hash = GetAssemblyBuildHash();
		
		if (!string.IsNullOrEmpty(build_hash))
			return $"core-{base_version}-{build_hash}";
		
		return $"core-{base_version}";
	}
	
	public static string GetAssemblyVersionWithBuild()
	{
		string base_version = GetAssemblyVersion();
		string build_hash = GetAssemblyBuildHash();
		
		if (!string.IsNullOrEmpty(build_hash))
			return $"*{base_version}* (build *{build_hash}*)";
		
		return base_version;
	}
	
	private static void InitializeIpcMode()
	{	
		IpcManager.RegisterStringHandler(IpcMessageId.HANDSHAKE_REQUEST, HandleHandshake);

		Log.Info($"IPC mode initialized with *{IpcManager.GetHandlerCount()}* handlers");
		IpcManager.StartListening();
		
		Log.Info("IPC listener has exited");
	}
	
	private static void HandleHandshake(string client_version)
	{	
		Log.Info($"Client version: {client_version}");
		
		string core_version = GetCoreVersionString();
		
		using Stream stdout = Console.OpenStandardOutput();
		IpcManager.SendStringMessage(stdout, IpcMessageId.HANDSHAKE_RESPONSE, core_version);
	}
}