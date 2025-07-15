
using System.Diagnostics;

namespace wow_export;

public partial class Program
{
	private static string? client_process_name;

	public static void Main()
	{
		try
		{
			Log.Write($"wow.export core version {AssemblyInfo.GetVersionWithBuild()}");
			Log.Write("Report any issues at https://github.com/Kruithne/wow.export/issues");
			Log.Blank();
			
			ProtobufIpcManager.RegisterHandler<HandshakeRequest>(HandleHandshakeRequest);
			ProtobufIpcManager.RegisterHandler<RegionListRequest>(HandleRegionListRequest);
			ProtobufIpcManager.RegisterHandler<UpdateApplicationRequest>(HandleUpdateApplicationRequest);
			ProtobufIpcManager.StartListening();
		}
		catch (Exception ex)
		{
			Log.Blank();
			Log.Write("A fatal error has occurred which has caused wow.export to crash");
			Log.Write("Considering reporting this error at https://github.com/Kruithne/wow.export/issues");
			Log.Blank();

			string error_code = ex is InternalError internal_error ? internal_error.ErrorCode : "unknown";
			Log.Write($"{ex.GetType().Name}: {ex.Message} ({error_code})");

			Error.CreateCrashDump(ex);

			Log.Blank();
			return;
		}
	}
	
	private static void HandleHandshakeRequest(HandshakeRequest request)
	{	
		Log.Write($"Client version: {request.ClientVersion}");
		Log.Write($"Client process: {request.ProcessName}");
		
		client_process_name = request.ProcessName;
		
		string core_version = AssemblyInfo.GetCoreVersionString();
		
		HandshakeResponse response = new()
		{
			CoreVersion = core_version
		};
		
		using Stream stdout = Console.OpenStandardOutput();
		ProtobufIpcManager.SendMessage(stdout, response);
	}
	
	private static void HandleRegionListRequest(RegionListRequest request)
	{	
		RegionListResponse response = ProtobufConversion.CreateRegionListResponse(CDNRegionData.ALL_REGIONS);
		
		using Stream stdout = Console.OpenStandardOutput();
		ProtobufIpcManager.SendMessage(stdout, response);
	}
	
	private static void HandleUpdateApplicationRequest(UpdateApplicationRequest request)
	{
		Task.Run(async () =>
		{
			Log.Write("Checking for updates...");
			await Task.Delay(5000);
			
			// todo
			// LaunchUpdater();
			// return;

			UpdateApplicationResponse response = new();
			
			using Stream stdout = Console.OpenStandardOutput();
			ProtobufIpcManager.SendMessage(stdout, response);
		});
	}
	
	private static void LaunchUpdater()
	{
		if (string.IsNullOrEmpty(client_process_name))
		{
			Log.Write("ERROR: Cannot launch updater - client process name not available");
			return;
		}
		
		try
		{
			string updater_executable = OperatingSystem.IsWindows()
				? "wow_export_updater.exe"
				: "wow_export_updater";
			
			if (!File.Exists(updater_executable))
			{
				Log.Write($"ERROR: Updater executable not found: {updater_executable}");
				return;
			}
			
			Log.Write($"Launching updater for process: {client_process_name}");
			
			using Process updater_process = new()
			{
				StartInfo = new ProcessStartInfo
				{
					FileName = updater_executable,
					Arguments = $"--parent={client_process_name}",
					UseShellExecute = false,
					CreateNoWindow = true
				}
			};
			
			updater_process.Start();
			
			// Exit core process to allow updater to do its work
			Environment.Exit(0);
		}
		catch (Exception ex)
		{
			Log.Write($"ERROR: Failed to launch updater: {ex.Message}");
		}
	}
}