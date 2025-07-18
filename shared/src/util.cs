using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace wow_export;

public static class Utils
{
	public static string FormatFileSize(long byte_count)
	{
		if (byte_count < 1024)
			return $"{byte_count}b";
		
		if (byte_count < 1024 * 1024)
		{
			double kilobytes = byte_count / 1024.0;
			return $"{kilobytes:F1}kb";
		}
		
		if (byte_count < 1024L * 1024 * 1024)
		{
			double megabytes = byte_count / (1024.0 * 1024);
			return $"{megabytes:F1}mb";
		}
		
		double gigabytes = byte_count / (1024.0 * 1024 * 1024);
		return $"{gigabytes:F1}gb";
	}
	
	public static string ComputeSha256Hash(string file_path)
	{
		try
		{
			using FileStream file_stream = new(file_path, FileMode.Open, FileAccess.Read);
			using SHA256 sha256 = SHA256.Create();
			byte[] hash_bytes = sha256.ComputeHash(file_stream);
			return Convert.ToHexString(hash_bytes).ToLowerInvariant();
		}
		catch
		{
			return string.Empty;
		}
	}
	
	public static bool DoesFileMatchSize(string file_path, long expected_size)
	{
		try
		{
			if (!File.Exists(file_path))
				return false;
			
			FileInfo file_info = new(file_path);
			return file_info.Length == expected_size;
		}
		catch
		{
			return false;
		}
	}
}