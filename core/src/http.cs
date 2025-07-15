using System.Text.Json;

namespace wow_export;

public static class HttpClient
{
	private static readonly System.Net.Http.HttpClient http_client = new();
	
	public static async Task<T?> DownloadJsonAsync<T>(string url)
	{
		try
		{
			Log.Write($"Downloading JSON from {url}");
			
			HttpResponseMessage response = await http_client.GetAsync(url);
			response.EnsureSuccessStatusCode();
			
			string json_content = await response.Content.ReadAsStringAsync();
			return JsonSerializer.Deserialize<T>(json_content);
		}
		catch (Exception ex)
		{
			Log.Write($"Failed to download JSON from {url}: {ex.Message}");
			return default;
		}
	}
	
	public static async Task<bool> DownloadFileAsync(string url, string local_path)
	{
		try
		{
			Log.Write($"Downloading file from {url} to {local_path}");
			
			string? directory = Path.GetDirectoryName(local_path);
			if (!string.IsNullOrEmpty(directory))
				Directory.CreateDirectory(directory);
			
			HttpResponseMessage response = await http_client.GetAsync(url);
			response.EnsureSuccessStatusCode();
			
			await using FileStream file_stream = new(local_path, FileMode.Create);
			await response.Content.CopyToAsync(file_stream);
			
			return true;
		}
		catch (Exception ex)
		{
			Log.Write($"Failed to download file from {url}: {ex.Message}");
			return false;
		}
	}
}