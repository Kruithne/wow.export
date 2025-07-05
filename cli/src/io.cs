using System.Runtime.InteropServices;

namespace wow_export;

public static class IO
{
	private static readonly string _cached_app_data_path;
	
	static IO()
	{
		string base_path;
		
		if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
		{
			base_path = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
		}
		else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
		{
			string home_path = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
			base_path = Path.Combine(home_path, "Library", "Application Support");
		}
		else
		{
			string home_path = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
			base_path = Path.Combine(home_path, ".local", "share");
		}
		
		_cached_app_data_path = Path.Combine(base_path, "wow.export");
	}
	
	public static string GetAppDataPath()
	{
		return _cached_app_data_path;
	}
	
	public static void CreateDirectory(string directory_path)
	{
		if (!Directory.Exists(directory_path))
			Directory.CreateDirectory(directory_path);
	}
	
	public static string GetAppDataDirectory(string subdirectory, bool create = false)
	{
		string combined_path = Path.Combine(_cached_app_data_path, subdirectory);
		
		if (create)
			CreateDirectory(combined_path);
		
		return combined_path;
	}
}