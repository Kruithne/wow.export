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
}