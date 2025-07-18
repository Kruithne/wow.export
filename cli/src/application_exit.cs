using System;

namespace wow_export;

public static class ApplicationExit
{
	public static void GracefulExit(int exit_code, string message)
	{
		if (!string.IsNullOrEmpty(message))
		{
			Log.Error(message);
			Log.Blank();
		}
		Environment.Exit(exit_code);
	}

	public static void GracefulExit(GracefulExitException ex)
	{
		GracefulExit(ex.ExitCode, ex.Message);
	}

	public static void FatalExit(Exception ex)
	{
		Log.Blank();
		Log.Error("A *fatal* error has occurred which has caused wow.export to *crash*");
		Log.Error("Considering reporting this error at *https://github.com/Kruithne/wow.export/issues*");
		Log.Blank();
		Log.Error($"*{ex.GetType().Name}*: {ex.Message}");
		Log.Blank();
		Environment.Exit(1);
	}
}