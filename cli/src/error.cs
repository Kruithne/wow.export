using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;

namespace wow_export;

public class InternalError(string message, object? diagnostic_info = null, [CallerFilePath] string file_path = "", [CallerLineNumber] int line_number = 0) : Exception(message)
{
	public string ErrorCode { get; } = $"{Path.GetFileNameWithoutExtension(file_path)}_{line_number}";
	public object? DiagnosticInfo { get; } = diagnostic_info;
}

public static class Error
{
	public static void CreateCrashDump(Exception ex)
	{
		try
		{
			string crash_log_directory = IO.GetAppDataDirectory("crashlog", create: true);
			long unix_timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
			string crash_file_path = Path.Combine(crash_log_directory, $"crash_{unix_timestamp}.log");
			
			StringBuilder crash_content = new();
			
			crash_content.AppendLine("=== WOW.EXPORT CRASH DUMP ===");
			crash_content.AppendLine($"Timestamp: {DateTimeOffset.UtcNow:yyyy-MM-dd HH:mm:ss UTC}");
			crash_content.AppendLine($"Unix Timestamp: {unix_timestamp}");
			crash_content.AppendLine();
			
			crash_content.AppendLine("=== SYSTEM INFORMATION ===");
			crash_content.AppendLine($"OS: {RuntimeInformation.OSDescription}");
			crash_content.AppendLine($"Architecture: {RuntimeInformation.OSArchitecture}");
			crash_content.AppendLine($"Framework: {RuntimeInformation.FrameworkDescription}");
			crash_content.AppendLine($"Process Architecture: {RuntimeInformation.ProcessArchitecture}");
			crash_content.AppendLine($"Machine Name: {Environment.MachineName}");
			crash_content.AppendLine($"User Name: {Environment.UserName}");
			crash_content.AppendLine();
			
			crash_content.AppendLine("=== CPU INFORMATION ===");
			CpuInfo cpu_info = Hardware.GetCpuInfo();
			crash_content.AppendLine($"CPU Model: {cpu_info.Name}");
			crash_content.AppendLine($"Max Clock Speed: {cpu_info.MaxClockSpeed} MHz");
			crash_content.AppendLine($"Physical Cores: {cpu_info.Cores}");
			crash_content.AppendLine($"Logical Processors: {cpu_info.LogicalProcessors}");
			crash_content.AppendLine($"Environment Processor Count: {Environment.ProcessorCount}");
			crash_content.AppendLine();
			
			crash_content.AppendLine("=== GPU INFORMATION ===");
			GpuInfo[] gpu_info = Hardware.GetGpuInfo();
			for (int i = 0; i < gpu_info.Length; i++)
			{
				GpuInfo gpu = gpu_info[i];
				crash_content.AppendLine($"GPU {i + 1}: {gpu.Name}");
				crash_content.AppendLine($"  Vendor: {gpu.Vendor}");
				if (gpu.Vram > 0)
					crash_content.AppendLine($"  VRAM: {Utils.FormatFileSize(gpu.Vram)}");
				if (!string.IsNullOrEmpty(gpu.VideoProcessor))
					crash_content.AppendLine($"  Video Processor: {gpu.VideoProcessor}");
			}
			crash_content.AppendLine();
			
			crash_content.AppendLine("=== MEMORY DIAGNOSTICS ===");
			
			// Process memory information
			Process current_process = Process.GetCurrentProcess();
			crash_content.AppendLine($"Process Working Set: {Utils.FormatFileSize(current_process.WorkingSet64)}");
			crash_content.AppendLine($"Process Virtual Memory: {Utils.FormatFileSize(current_process.VirtualMemorySize64)}");
			crash_content.AppendLine($"Process Private Memory: {Utils.FormatFileSize(current_process.PrivateMemorySize64)}");
			crash_content.AppendLine($"Process Paged Memory: {Utils.FormatFileSize(current_process.PagedMemorySize64)}");
			
			// Managed memory information
			long managed_memory_before = GC.GetTotalMemory(false);
			long managed_memory_after = GC.GetTotalMemory(true);
			crash_content.AppendLine($"Managed Memory (before GC): {Utils.FormatFileSize(managed_memory_before)}");
			crash_content.AppendLine($"Managed Memory (after GC): {Utils.FormatFileSize(managed_memory_after)}");
			crash_content.AppendLine($"Memory Freed by GC: {Utils.FormatFileSize(managed_memory_before - managed_memory_after)}");
			
			// System memory information
			GCMemoryInfo gc_memory_info = GC.GetGCMemoryInfo();
			crash_content.AppendLine($"Total Available Memory: {Utils.FormatFileSize(gc_memory_info.TotalAvailableMemoryBytes)}");
			crash_content.AppendLine($"Memory Load: {Utils.FormatFileSize(gc_memory_info.MemoryLoadBytes)}");
			crash_content.AppendLine($"High Memory Load Threshold: {Utils.FormatFileSize(gc_memory_info.HighMemoryLoadThresholdBytes)}");
			
			// Memory usage calculations
			double memory_usage_percent = (double)gc_memory_info.MemoryLoadBytes / gc_memory_info.TotalAvailableMemoryBytes * 100;
			crash_content.AppendLine($"System Memory Usage: {memory_usage_percent:F1}%");
			crash_content.AppendLine();
			
			crash_content.AppendLine("=== ERROR INFORMATION ===");
			string error_code = ex is InternalError internal_error ? internal_error.ErrorCode : "unknown";
			crash_content.AppendLine($"Error Code: {error_code}");
			crash_content.AppendLine($"Exception Type: {ex.GetType().Name}");
			crash_content.AppendLine($"Message: {ex.Message}");
			crash_content.AppendLine();
			
			if (ex is InternalError internal_error_with_diagnostic && internal_error_with_diagnostic.DiagnosticInfo != null)
			{
				crash_content.AppendLine("=== DIAGNOSTIC INFORMATION ===");
				crash_content.AppendLine(FormatDiagnosticInfo(internal_error_with_diagnostic.DiagnosticInfo));
				crash_content.AppendLine();
			}
			
			crash_content.AppendLine("=== STACK TRACE ===");
			crash_content.AppendLine(ex.StackTrace ?? "No stack trace available");
			crash_content.AppendLine();
			
			crash_content.AppendLine("=== ASSEMBLY INFORMATION ===");
			Assembly executing_assembly = Assembly.GetExecutingAssembly();
			crash_content.AppendLine($"Assembly: {executing_assembly.FullName}");
			crash_content.AppendLine($"Version: {executing_assembly.GetName().Version}");
			crash_content.AppendLine();
			
			File.WriteAllText(crash_file_path, crash_content.ToString());
			Log.Error($"Created crash dump file *{crash_file_path}*");
		}
		catch
		{
			Log.Error("Crash dump generation failed");
		}
	}
	
	private static string FormatDiagnosticInfo(object diagnostic_info)
	{
		PropertyInfo[] properties = diagnostic_info.GetType().GetProperties();
		List<string> formatted_lines = [];
		
		foreach (PropertyInfo property in properties)
		{
			object? value = property.GetValue(diagnostic_info);
			formatted_lines.Add($"{property.Name}: {value}");
		}
		
		return string.Join("\n", formatted_lines);
	}
}