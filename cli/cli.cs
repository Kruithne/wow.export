using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;

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

			string error_code = ex is InternalError internal_error ? internal_error.ErrorCode : "unknown";
			Log.Error($"*{ex.GetType().Name}*: {ex.Message} (*{error_code}*)");

			Error.CreateCrashDump(ex);

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
		ipc_client.RegisterHandler("HANDSHAKE_RESPONSE", HandleHandshakeResponse);
		
		Task.Run(() => ipc_client.StartListening());
		
		Task.Delay(1000).ContinueWith(_ => SendHandshake());
	}
	
	private static void SendHandshake()
	{
		string test_value = Guid.NewGuid().ToString();
		Log.Info($"Sending handshake to core with test value: {test_value}");
		
		HandshakeData handshake_data = new HandshakeData
		{
			versions = new HandshakeVersions
			{
				platform = Environment.OSVersion.Platform.ToString(),
				electron = "N/A",
				chrome = "N/A", 
				node = "N/A"
			}
		};
		
		ipc_client?.SendMessage("HANDSHAKE", handshake_data);
	}
	
	private static void HandleHandshakeResponse(IpcMessage message, IpcBinaryChunk[] binary_chunks)
	{
		Log.Info("Received handshake response from core");
		
		if (message.data != null)
		{
			string data_string = message.data.ToString() ?? "null";
			HandshakeResponse? response = JsonSerializer.Deserialize<HandshakeResponse>(data_string);
			
			if (response != null)
			{
				Log.Info($"Core version: {response.version}");
				Log.Info($"Handshake timestamp: {response.timestamp}");
			}
		}
	}
}