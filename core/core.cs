using System.Runtime.InteropServices;

namespace wow_export;

public static class Core
{
	[UnmanagedCallersOnly(EntryPoint = "GetCoreVersion")]
	public static nint GetCoreVersion()
	{
		string version = "Core v2.0.0";
		return Marshal.StringToHGlobalAnsi(version);
	}
}