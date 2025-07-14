using System.Reflection;

namespace wow_export;

public partial class Program
{
	public static void Main()
	{
		try
		{
			Log.Write($"Welcome to wow.export core version {GetAssemblyVersionWithBuild()}");
			Log.Write("Report any issues at https://github.com/Kruithne/wow.export/issues");
			Log.Blank();
			
			IpcManager.RegisterStringHandler(IpcMessageId.HANDSHAKE_REQUEST, HandleHandshake);
			IpcManager.StartListening();
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
	
	public static string GetAssemblyVersion()
	{
		Version? version = Assembly.GetExecutingAssembly().GetName().Version;

		return version?.ToString(3) ?? throw new InternalError("Assembly version is not available.");
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
			return $"{base_version} (build {build_hash})";
		
		return base_version;
	}
	
	private static void HandleHandshake(string client_version)
	{	
		Log.Write($"Client version: {client_version}");
		
		string core_version = GetCoreVersionString();
		
		using Stream stdout = Console.OpenStandardOutput();
		IpcManager.SendStringMessage(stdout, IpcMessageId.HANDSHAKE_RESPONSE, core_version);
	}
}