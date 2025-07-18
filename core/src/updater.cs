using System.Runtime.InteropServices;
using System.Text.Json.Serialization;

namespace wow_export;

public class UpdateManifestEntry
{
	[JsonPropertyName("path")]
	public string Path { get; set; } = string.Empty;
	
	[JsonPropertyName("size")]
	public long Size { get; set; }
	
	[JsonPropertyName("hash")]
	public string Hash { get; set; } = string.Empty;
}

[JsonSerializable(typeof(UpdateManifestEntry[]))]
[JsonSerializable(typeof(UpdateManifestEntry))]
[JsonSourceGenerationOptions(WriteIndented = false)]
public partial class UpdaterJsonContext : JsonSerializerContext
{
}

public static class Updater
{
	private static string GetPlatformString()
	{
		if (OperatingSystem.IsWindows())
			return "win32";
		
		if (OperatingSystem.IsLinux())
			return "linux";
		
		if (OperatingSystem.IsMacOS())
			return "darwin";
		
		return "unknown";
	}
	
	private static string GetArchitectureString()
	{
		return RuntimeInformation.OSArchitecture switch
		{
			Architecture.X64 => "x64",
			Architecture.Arm64 => "arm64",
			Architecture.X86 => "x86",
			Architecture.Arm => "arm",
			_ => "unknown"
		};
	}
	
	private static string GetUpdateManifestUrl()
	{
		string platform = GetPlatformString();
		string architecture = GetArchitectureString();
		return $"https://kruithne.net/wow.export/v2/update/manifest/{platform}_{architecture}.json";
	}
	
	public static async Task<bool> CheckForUpdatesAsync(Action<UpdateApplicationStats>? stats_callback = null, Action<UpdateApplicationProgress>? progress_callback = null)
	{
		try
		{
			Log.Write("Checking for updates...");
			
			string manifest_url = GetUpdateManifestUrl();
			Log.Write($"Downloading update manifest from: {manifest_url}");
			
			UpdateManifestEntry[]? manifest = await HttpClient.DownloadUpdateManifestAsync(manifest_url);
			
			if (manifest == null || manifest.Length == 0)
			{
				Log.Write("No update manifest found or manifest is empty");
				return false;
			}
			
			Log.Write($"Found {manifest.Length} files in update manifest");
			
			List<UpdateManifestEntry> files_to_update = [];
			string app_directory = Directory.GetCurrentDirectory();
			
			foreach (UpdateManifestEntry entry in manifest)
			{
				string local_file_path = Path.Combine(app_directory, entry.Path);
				
				if (!Utils.DoesFileMatchSize(local_file_path, entry.Size))
				{
					Log.Write($"File {entry.Path} size mismatch or missing - marked for update");
					files_to_update.Add(entry);
					continue;
				}
				
				string local_hash = Utils.ComputeSha256Hash(local_file_path);
				if (local_hash != entry.Hash)
				{
					Log.Write($"File {entry.Path} hash mismatch - marked for update");
					files_to_update.Add(entry);
					continue;
				}
			}
			
			if (files_to_update.Count == 0)
			{
				Log.Write("No files need updating");
				return false;
			}
			
			Log.Write($"{files_to_update.Count} files need updating");
			
			ulong total_size = (ulong)files_to_update.Sum(f => f.Size);
			
			stats_callback?.Invoke(new UpdateApplicationStats
			{
				TotalFiles = (uint)files_to_update.Count,
				TotalSize = total_size
			});
			
			string update_directory = Path.Combine(app_directory, ".update");
			Directory.CreateDirectory(update_directory);
			
			string platform = GetPlatformString();
			string architecture = GetArchitectureString();
			string base_download_url = $"https://kruithne.net/wow.export/v2/update/dist/{platform}_{architecture}/";
			
			for (int i = 0; i < files_to_update.Count; i++)
			{
				UpdateManifestEntry entry = files_to_update[i];
				
				progress_callback?.Invoke(new UpdateApplicationProgress
				{
					FileNumber = (uint)(i + 1),
					FileName = entry.Path,
					FileSize = (ulong)entry.Size
				});
				
				string download_url = base_download_url + entry.Path.Replace('\\', '/');
				string local_update_path = Path.Combine(update_directory, entry.Path);
				
				bool download_success = await HttpClient.DownloadFileAsync(download_url, local_update_path);
				
				if (!download_success)
				{
					Log.Write($"Failed to download {entry.Path} - update aborted");
					return false;
				}
				
				string downloaded_hash = Utils.ComputeSha256Hash(local_update_path);
				if (downloaded_hash != entry.Hash)
				{
					Log.Write($"Downloaded file {entry.Path} hash verification failed - update aborted");
					return false;
				}
			}
			
			Log.Write("All files downloaded successfully");
			return true;
		}
		catch (Exception ex)
		{
			Log.Write($"Error during update check: {ex.Message}");
			return false;
		}
	}
}