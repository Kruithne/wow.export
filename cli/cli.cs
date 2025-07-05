using System.Reflection;

namespace wow_export;

public class Program
{
	public static void Main()
	{
		try
		{
			Log.Info($"Welcome to wow.export version *{GetAssemblyVersion()}*");
			Log.Info("Report any issues at *https://github.com/Kruithne/wow.export/issues*");
			Log.Blank();
			
			// Check for help flag and exit early if present
			if (CLIFlags.Has(CLIFlag.HELP))
			{
				CLIFlags.PrintHelp();
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
}