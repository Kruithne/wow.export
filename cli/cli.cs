using System.Diagnostics;
using System.Reflection;

namespace wow_export;

public partial class Program
{
	private static Process? core_process;
	private static CliIpcClient? ipc_client;

	public static void Main()
	{
		try
		{
			Log.Info($"Welcome to wow.export CLI version {GetAssemblyVersionWithBuild()}");
			Log.Info("Report any issues at *https://github.com/Kruithne/wow.export/issues*");
			Log.Blank();
			
			if (CLIFlags.Has(CLIFlag.HELP))
			{
				CLIFlags.PrintHelp();
				return;
			}
			
			SpawnCoreProcess();
			
			Log.Info("CLI initialized, waiting for commands...");
			Console.ReadLine();
		}
		catch (Exception ex)
		{
			Log.Blank();
			Log.Error("A *fatal* error has occurred which has caused wow.export to *crash*");
			Log.Error("Considering reporting this error at *https://github.com/Kruithne/wow.export/issues*");
			Log.Blank();

			Log.Error($"*{ex.GetType().Name}*: {ex.Message}");

			Log.Blank();
			return;
		}
		finally
		{
			core_process?.Kill();
		}
	}
	
	public static string GetAssemblyVersion()
	{
		Version? version = Assembly.GetExecutingAssembly().GetName().Version;

		if (version == null)
			throw new InvalidOperationException("Assembly version is not available.");

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
	
	public static string GetCliVersionString()
	{
		string base_version = GetAssemblyVersion();
		string build_hash = GetAssemblyBuildHash();
		
		if (!string.IsNullOrEmpty(build_hash))
			return $"cli-{base_version}-{build_hash}";
		
		return $"cli-{base_version}";
	}
	
	public static string GetAssemblyVersionWithBuild()
	{
		string base_version = GetAssemblyVersion();
		string build_hash = GetAssemblyBuildHash();
		
		if (!string.IsNullOrEmpty(build_hash))
			return $"*{base_version}* (build *{build_hash}*)";
		
		return base_version;
	}
	
	private static void SpawnCoreProcess()
	{
		string core_executable = Environment.OSVersion.Platform == PlatformID.Win32NT 
			? "wow_export_core.exe" 
			: "wow_export_core";
		
		if (!File.Exists(core_executable))
		{
			Log.Error($"Core executable not found at: {core_executable}");
			return;
		}
		
		Log.Info($"Spawning core process: {core_executable}");
		
		core_process = new Process
		{
			StartInfo = new ProcessStartInfo
			{
				FileName = core_executable,
				Arguments = "--context=ipc",
				RedirectStandardInput = true,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				UseShellExecute = false,
				CreateNoWindow = true
			}
		};
		
		core_process.Start();
		
		ipc_client = new CliIpcClient(core_process);
		ipc_client.RegisterStringHandler(IpcMessageId.HANDSHAKE_RESPONSE, HandleHandshakeResponse);
		
		Task.Run(() => ipc_client.StartListening());
		
		Task.Delay(1000).ContinueWith(_ => SendHandshake());
	}
	
	private static void SendHandshake()
	{
		Log.Info("Sending handshake to core");
		
		string cli_version = GetCliVersionString();
		
		ipc_client?.SendStringMessage(IpcMessageId.HANDSHAKE_REQUEST, cli_version);
	}
	
	private static void HandleHandshakeResponse(string core_version)
	{
		Log.Info("Received handshake response from core");
		Log.Info($"Core version: {core_version}");
	}
}