using System;
using System.Threading.Tasks;

namespace wow_export;

public static class GlobalExceptionHandler
{
	private static bool _is_registered = false;

	public static void Register()
	{
		if (_is_registered)
			return;

		AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
		TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
		_is_registered = true;
	}

	private static void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
	{
		if (e.ExceptionObject is Exception ex)
			HandleException(ex);
	}

	private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
	{
		HandleException(e.Exception);
		e.SetObserved();
	}

	private static void HandleException(Exception ex)
	{
		if (ex is GracefulExitException graceful_ex)
			ApplicationExit.GracefulExit(graceful_ex);
		else
			ApplicationExit.FatalExit(ex);
	}
}