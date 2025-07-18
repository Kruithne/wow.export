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
		ipc_client.RegisterHandler<UpdateApplicationResponse>(HandleUpdateApplicationResponse);
		ipc_client.RegisterHandler<UpdateApplicationStats>(HandleUpdateApplicationStats);
		ipc_client.RegisterHandler<UpdateApplicationProgress>(HandleUpdateApplicationProgress);
		
		Task.Run(() => ipc_client.StartListening());
		
		Task.Delay(1000).ContinueWith(_ => SendHandshake());
	}
	
	private static void SendHandshake()
	{	
		string cli_version = AssemblyInfo.GetCliVersionString();
		string process_name = OperatingSystem.IsWindows() ? "wow_export_cli.exe" : "wow_export_cli";
		
		HandshakeRequest request = new()
		{
			ClientVersion = cli_version,
			ProcessName = process_name
		};
		
		ipc_client?.SendMessage(request);
	}
	
	private static void HandleHandshakeResponse(HandshakeResponse response)
	{
		Log.Info($"Core version *{response.CoreVersion}* initialized");
		Log.Blank();
		
		if (Utils.IsDebugMode())
		{
			Log.Info("Debug mode, skipping update check");
			Log.Blank();
			
			RegionListRequest request = new();
			ipc_client?.SendMessage(request);
			return;
		}
		
		Log.Info("Checking for updates...");
		UpdateApplicationRequest update_request = new();
		ipc_client?.SendMessage(update_request);
	}
	
	private static void HandleUpdateApplicationResponse(UpdateApplicationResponse response)
	{
		Log.Success("Everything is up-to-date!");
		Log.Blank();
		
		RegionListRequest request = new();
		ipc_client?.SendMessage(request);
	}
	
	private static uint total_files_to_update = 0;
	
	private static void HandleUpdateApplicationStats(UpdateApplicationStats stats)
	{
		total_files_to_update = stats.TotalFiles;
		string total_size = Utils.FormatFileSize((long)stats.TotalSize);
		Log.Info($"Updating *{stats.TotalFiles}* files (*{total_size}*)");
	}
	
	private static void HandleUpdateApplicationProgress(UpdateApplicationProgress progress)
	{
		string file_size = Utils.FormatFileSize((long)progress.FileSize);
		Log.Info($"Downloading *{progress.FileName}* *{progress.FileNumber}*/*{total_files_to_update}* (*{file_size}*)");
	}
	
	private static void HandleRegionListResponse(RegionListResponse response)
	{
		CDNRegionData[] regions = ProtobufConversion.ExtractRegionsFromResponse(response);
		Log.Verbose($"Received *{regions.Length}* regions");
		
		RegionSelector.SetAvailableRegions(regions);
		RegionSelector.SelectRegion();
	}
}