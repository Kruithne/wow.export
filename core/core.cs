
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
			
			ProtobufIpcManager.RegisterHandler<HandshakeRequest>(HandleHandshakeRequest);
			ProtobufIpcManager.RegisterHandler<RegionListRequest>(HandleRegionListRequest);
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
}