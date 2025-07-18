using System;

namespace wow_export;

public abstract class CLIException : Exception
{
	protected CLIException(string message) : base(message) { }
	protected CLIException(string message, Exception inner_exception) : base(message, inner_exception) { }
}

public class GracefulExitException : CLIException
{
	public int ExitCode { get; }
	
	public GracefulExitException(int exit_code, string message) : base(message)
	{
		ExitCode = exit_code;
	}
}

public class MissingCdnRegionException : GracefulExitException
{
	public string[] AvailableRegions { get; }
	
	public MissingCdnRegionException(string[] available_regions) 
		: base(1, "CDN region not specified")
	{
		AvailableRegions = available_regions;
	}
}

public class InvalidCdnRegionException : GracefulExitException
{
	public string InvalidRegion { get; }
	public string[] AvailableRegions { get; }
	
	public InvalidCdnRegionException(string invalid_region, string[] available_regions)
		: base(1, $"Region '{invalid_region}' not found in available regions")
	{
		InvalidRegion = invalid_region;
		AvailableRegions = available_regions;
	}
}