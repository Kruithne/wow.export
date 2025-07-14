using System.Reflection;

namespace wow_export;

public static class AssemblyInfo
{
	public static string GetVersion()
	{
		Version? version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;

		return version?.ToString(3) ?? throw new InternalError("Assembly version is not available.");
	}
	
	public static string GetBuildHash()
	{
		string? informational_version = System.Reflection.Assembly.GetExecutingAssembly()
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
	
	public static string GetVersionWithBuild()
	{
		string base_version = GetVersion();
		string build_hash = GetBuildHash();
		
		if (!string.IsNullOrEmpty(build_hash))
			return $"{base_version} (build {build_hash})";
		
		return base_version;
	}
}