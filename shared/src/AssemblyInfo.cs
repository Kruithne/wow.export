using System.Reflection;

namespace wow_export;

public static class AssemblyInfo
{
	public static string GetVersion()
	{
		Version? version = Assembly.GetExecutingAssembly().GetName().Version;

		if (version == null)
			throw new InvalidOperationException("Assembly version is not available.");

		return version.ToString(3);
	}
	
	public static string GetBuildHash()
	{
		string? informational_version = Assembly.GetExecutingAssembly()
			.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
		
		if (informational_version != null && informational_version.Contains('+'))
			return informational_version.Split('+')[1];
		
		return string.Empty;
	}
	
	public static string GetCoreVersionString()
	{
		string base_version = GetVersion();
		string build_hash = GetBuildHash();
		
		if (!string.IsNullOrEmpty(build_hash))
			return $"core-{base_version}-{build_hash}";
		
		return $"core-{base_version}";
	}
	
	public static string GetCliVersionString()
	{
		string base_version = GetVersion();
		string build_hash = GetBuildHash();
		
		if (!string.IsNullOrEmpty(build_hash))
			return $"cli-{base_version}-{build_hash}";
		
		return $"cli-{base_version}";
	}
	
	public static string GetVersionWithBuild()
	{
		string base_version = GetVersion();
		string build_hash = GetBuildHash();
		
		if (!string.IsNullOrEmpty(build_hash))
			return $"*{base_version}* (build *{build_hash}*)";
		
		return base_version;
	}
}