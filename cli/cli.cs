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
		ipc_client.RegisterHandler(IpcMessageId.HANDSHAKE_RESPONSE, HandleHandshakeResponse);
		ipc_client.RegisterHandler(IpcMessageId.RES_REGION_LIST, HandleRegionListResponse);
		
		Task.Run(() => ipc_client.StartListening());
		
		Task.Delay(1000).ContinueWith(_ => SendHandshake());
	}
	
	private static void SendHandshake()
	{	
		string cli_version = AssemblyInfo.GetCliVersionString();	
		ipc_client?.SendStringMessage(IpcMessageId.HANDSHAKE_REQUEST, cli_version);
	}
	
	private static void HandleHandshakeResponse(IPCMessageReader data)
	{
		string core_version = data.ReadLengthPrefixedString().Result;
		Log.Info($"Core version *{core_version}* initialized");
		Log.Blank();
		
		ipc_client?.SendEmptyMessage(IpcMessageId.REQ_REGION_LIST);
	}
	
	private static void HandleRegionListResponse(IPCMessageReader data)
	{
		CDNRegionData[] regions = data.ReadArray<CDNRegionData>().Result;
		Log.Verbose($"Received *{regions.Length}* regions");
		
		RegionSelector.SetAvailableRegions(regions);
		RegionSelector.SelectRegion();
	}
}