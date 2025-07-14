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

			Log.Info($"Initializing...");
			SpawnCoreProcess();
			
			while (true)
			{
				Thread.Sleep(100);
			}
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
		string core_executable = OperatingSystem.IsWindows()
			? "wow_export_core.exe" 
			: "wow_export_core";
		
		if (!File.Exists(core_executable))
		{
			Log.Error($"Core executable not found at: {core_executable}");
			return;
		}
		
		Log.Verbose($"Spawning core process *{core_executable}*");
		
		core_process = new Process
		{
			StartInfo = new ProcessStartInfo
			{
				FileName = core_executable,
				RedirectStandardInput = true,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				UseShellExecute = false,
				CreateNoWindow = true
			}
		};
		
		core_process.Start();

		Log.Verbose($"Spawned core process with PID *{core_process.Id}*");
		
		ipc_client = new CliIpcClient(core_process);
		ipc_client.RegisterHandler<HandshakeResponse>(HandleHandshakeResponse);
		ipc_client.RegisterHandler<RegionListResponse>(HandleRegionListResponse);
		
		Task.Run(() => ipc_client.StartListening());
		
		Task.Delay(1000).ContinueWith(_ => SendHandshake());
	}
	
	private static void SendHandshake()
	{	
		string cli_version = AssemblyInfo.GetCliVersionString();
		
		HandshakeRequest request = new()
		{
			ClientVersion = cli_version
		};
		
		ipc_client?.SendMessage(request);
	}
	
	private static void HandleHandshakeResponse(HandshakeResponse response)
	{
		Log.Info($"Core version *{response.CoreVersion}* initialized");
		Log.Blank();
		
		RegionListRequest request = new();
		ipc_client?.SendMessage(request);
	}
	
	private static void HandleRegionListResponse(RegionListResponse response)
	{
		CDNRegionData[] regions = ProtobufConversion.ExtractRegionsFromResponse(response);
		Log.Verbose($"Received *{regions.Length}* regions");
		
		RegionSelector.SetAvailableRegions(regions);
		RegionSelector.SelectRegion();
	}
}