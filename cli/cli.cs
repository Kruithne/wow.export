using System.Diagnostics;

namespace wow_export;

public partial class Program
{
	private static Process? core_process;
	private static CliIpcClient? ipc_client;

	public static void Main()
	{
		try
		{
			Log.Info($"Welcome to wow.export CLI version {AssemblyInfo.GetVersionWithBuild()}");
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
		ipc_client.RegisterHandler(IpcMessageId.HANDSHAKE_RESPONSE, HandleHandshakeResponse);
		
		Task.Run(() => ipc_client.StartListening());
		
		Task.Delay(1000).ContinueWith(_ => SendHandshake());
	}
	
	private static void SendHandshake()
	{
		Log.Info("Sending handshake to core");
		
		string cli_version = AssemblyInfo.GetCliVersionString();
		
		ipc_client?.SendStringMessage(IpcMessageId.HANDSHAKE_REQUEST, cli_version);
	}
	
	private static void HandleHandshakeResponse(IPCMessageReader data)
	{
		string core_version = data.ReadLengthPrefixedString().Result;
		Log.Info("Received handshake response from core");
		Log.Info($"Core version: {core_version}");
	}
}