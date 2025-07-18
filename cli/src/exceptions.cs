using System;

namespace wow_export;

public abstract class CLIException : Exception
{
	protected CLIException(string message) : base(message) { }
	protected CLIException(string message, Exception inner_exception) : base(message, inner_exception) { }
}

public class GracefulExitException(int exit_code, string message) : CLIException(message)
{
	public int ExitCode { get; } = exit_code;
}

public class MissingCdnRegionException(string[] available_regions) : GracefulExitException(1, "CDN region not specified")
{
	public string[] AvailableRegions { get; } = available_regions;
}

public class InvalidCdnRegionException(string invalid_region, string[] available_regions) : GracefulExitException(1, $"Region '{invalid_region}' not found in available regions")
{
	public string InvalidRegion { get; } = invalid_region;
	public string[] AvailableRegions { get; } = available_regions;
}