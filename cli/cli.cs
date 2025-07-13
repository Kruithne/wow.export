using System.Reflection;
using System.Runtime.InteropServices;

namespace wow_export;

public partial class Program
{
	[LibraryImport("wow_export")]
	private static partial nint GetCoreVersion();

	public static void Main()
	{
		try
		{
			// Test core DLL loading
			try
			{
				nint core_version_ptr = GetCoreVersion();
				string core_version = Marshal.PtrToStringAnsi(core_version_ptr) ?? "Unknown";
				Console.WriteLine($"Loaded: {core_version}");
			}
			catch (Exception dll_ex)
			{
				Console.WriteLine($"Failed to load core DLL: {dll_ex.Message}");
			}

			Log.Info($"Welcome to wow.export version {GetAssemblyVersionWithBuild()}");
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