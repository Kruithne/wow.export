using System.Runtime.InteropServices;

namespace wow_export;

public static class IO
{
	public static readonly string AppDataDirectory;
	
	static IO()
	{
		string base_path;
		
		if (OperatingSystem.IsWindows())
		{
			base_path = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
		}
		else if (OperatingSystem.IsMacOS())
		{
			string home_path = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
			base_path = Path.Combine(home_path, "Library", "Application Support");
		}
		else
		{
			string home_path = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
			base_path = Path.Combine(home_path, ".local", "share");
		}
		
		AppDataDirectory = Path.Combine(base_path, "wow.export");
	}
	
	public static void CreateDirectory(string directory_path)
	{
		if (!Directory.Exists(directory_path))
			Directory.CreateDirectory(directory_path);
	}
	
	public static string GetAppDataDirectory(string subdirectory, bool create = false)
	{
		string combined_path = Path.Combine(AppDataDirectory, subdirectory);
		
		if (create)
			CreateDirectory(combined_path);
		
		return combined_path;
	}
}