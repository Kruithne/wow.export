
namespace wow_export;

public partial class Program
{
	public static void Main()
	{
		try
		{
			Log.Write($"wow.export core version {AssemblyInfo.GetVersionWithBuild()}");
			Log.Write("Report any issues at https://github.com/Kruithne/wow.export/issues");
			Log.Blank();
			
			IpcManager.RegisterHandler(IpcMessageId.HANDSHAKE_REQUEST, HandleHandshake);
			IpcManager.RegisterHandler(IpcMessageId.REQ_REGION_LIST, HandleRegionListRequest);
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
	
	private static void HandleHandshake(IPCMessageReader data)
	{	
		string client_version = data.ReadLengthPrefixedString().Result;
		Log.Write($"Client version: {client_version}");
		
		string core_version = AssemblyInfo.GetCoreVersionString();
		
		using Stream stdout = Console.OpenStandardOutput();
		IpcManager.SendStringMessage(stdout, IpcMessageId.HANDSHAKE_RESPONSE, core_version);
	}
	
	private static void HandleRegionListRequest(IPCMessageReader data)
	{	
		using Stream stdout = Console.OpenStandardOutput();
		IpcManager.SendArrayMessage(stdout, IpcMessageId.RES_REGION_LIST, CDNRegionData.ALL_REGIONS);
	}
}