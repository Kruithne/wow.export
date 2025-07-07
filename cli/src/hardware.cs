using System.Diagnostics;
using System.Runtime.InteropServices;

namespace wow_export;

public static class Hardware
{
	public static CpuInfo GetCpuInfo()
	{
		try
		{
			if (OperatingSystem.IsWindows())
				return GetWindowsCpuInfo();

			if (OperatingSystem.IsLinux())
				return GetLinuxCpuInfo();

			if (OperatingSystem.IsMacOS())
				return GetMacCpuInfo();
		}
		catch
		{
			// failed to get CPU info
		}

		return new CpuInfo { Name = "Unknown", Cores = Environment.ProcessorCount };
	}

	public static GpuInfo[] GetGpuInfo()
	{
		try
		{
			if (OperatingSystem.IsWindows())
				return GetWindowsGpuInfo();

			if (OperatingSystem.IsLinux())
				return GetLinuxGpuInfo();

			if (OperatingSystem.IsMacOS())
				return GetMacGpuInfo();
		}
		catch
		{
			// failed to get CPU info
		}

		return [new GpuInfo { Name = "Unknown", Vendor = "Unknown" }];
	}

	private static CpuInfo GetWindowsCpuInfo()
	{
		string wmic_output = RunCommand("wmic", "cpu get Name,MaxClockSpeed,NumberOfCores,NumberOfLogicalProcessors /format:csv");
		
		if (string.IsNullOrEmpty(wmic_output))
			return new CpuInfo { Name = "Unknown", Cores = Environment.ProcessorCount };

		string[] lines = wmic_output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
		
		foreach (string line in lines)
		{
			if (line.Contains("MaxClockSpeed"))
				continue;
				
			string[] parts = line.Split(',') ?? [];
			if (parts.Length >= 5)
			{
				string? name = parts[2].Trim();
				if (int.TryParse(parts[1]?.Trim(), out int max_clock_speed) && 
					int.TryParse(parts[3]?.Trim(), out int cores) &&
					int.TryParse(parts[4]?.Trim(), out int logical_processors))
				{
					return new CpuInfo
					{
						Name = name ?? "Unknown",
						MaxClockSpeed = max_clock_speed,
						Cores = cores,
						LogicalProcessors = logical_processors
					};
				}
			}
		}
		
		return new CpuInfo { Name = "Unknown", Cores = Environment.ProcessorCount };
	}

	private static CpuInfo GetLinuxCpuInfo()
	{
		try
		{
			string cpuinfo_content = File.ReadAllText("/proc/cpuinfo");
			
			string? model_name = null;
			int cores = 0;
			double cpu_mhz = 0;
			HashSet<string> physical_ids = [];
			
			foreach (string line in cpuinfo_content.Split('\n'))
			{
				if (line.StartsWith("model name"))
				{
					model_name = line.Split(':')[1].Trim();
				}
				else if (line.StartsWith("cpu MHz"))
				{
					string mhz_str = line.Split(':')[1].Trim();
					_ = double.TryParse(mhz_str, out cpu_mhz);
				}
				else if (line.StartsWith("physical id"))
				{
					string physical_id = line.Split(':')[1].Trim();
					physical_ids.Add(physical_id);
				}
				else if (line.StartsWith("processor"))
				{
					cores++;
				}
			}
			
			int physical_cores = physical_ids.Count > 0 ? physical_ids.Count : cores;
			
			return new CpuInfo
			{
				Name = model_name ?? "Unknown",
				MaxClockSpeed = (int)cpu_mhz,
				Cores = physical_cores,
				LogicalProcessors = cores
			};
		}
		catch
		{
			return new CpuInfo { Name = "Unknown", Cores = Environment.ProcessorCount };
		}
	}

	private static CpuInfo GetMacCpuInfo()
	{
		string sysctl_output = RunCommand("sysctl", "-n machdep.cpu.brand_string");
		string core_count_output = RunCommand("sysctl", "-n hw.physicalcpu");
		string logical_count_output = RunCommand("sysctl", "-n hw.logicalcpu");
		string freq_output = RunCommand("sysctl", "-n hw.cpufrequency_max");
		
		string cpu_name = string.IsNullOrEmpty(sysctl_output) ? "Unknown" : sysctl_output.Trim();
		_ = int.TryParse(core_count_output?.Trim(), out int cores);
		_ = int.TryParse(logical_count_output?.Trim(), out int logical_processors);
		_ = long.TryParse(freq_output?.Trim(), out long frequency_hz);
		
		return new CpuInfo
		{
			Name = cpu_name,
			MaxClockSpeed = frequency_hz > 0 ? (int)(frequency_hz / 1000000) : 0,
			Cores = cores > 0 ? cores : Environment.ProcessorCount,
			LogicalProcessors = logical_processors > 0 ? logical_processors : Environment.ProcessorCount
		};
	}

	private static GpuInfo[] GetWindowsGpuInfo()
	{
		string wmic_output = RunCommand("wmic", "path win32_VideoController get Name,AdapterRAM,VideoProcessor /format:csv");
		
		if (string.IsNullOrEmpty(wmic_output))
			return [new GpuInfo { Name = "Unknown", Vendor = "Unknown" }];

		List<GpuInfo> gpus = [];
		string[] lines = wmic_output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
		
		foreach (string line in lines)
		{
			if (line.Contains("AdapterRAM"))
				continue;
				
			string[] parts = line.Split(',');
			if (parts.Length >= 4)
			{
				string? adapter_ram_str = parts[1]?.Trim();
				string? name = parts[2]?.Trim();
				string? video_processor = parts[3]?.Trim();
				
				if (!string.IsNullOrEmpty(name) && name != "Name")
				{
					_ = long.TryParse(adapter_ram_str, out long adapter_ram);
					
					gpus.Add(new GpuInfo
					{
						Name = name,
						Vendor = ExtractVendor(name),
						Vram = adapter_ram,
						VideoProcessor = video_processor
					});
				}
			}
		}
		
		return gpus.Count > 0 ? [.. gpus] : [new GpuInfo { Name = "Unknown", Vendor = "Unknown" }];
	}

	private static GpuInfo[] GetLinuxGpuInfo()
	{
		string lspci_output = RunCommand("lspci", "-v");
		
		if (string.IsNullOrEmpty(lspci_output))
			return [new GpuInfo { Name = "Unknown", Vendor = "Unknown" }];

		List<GpuInfo> gpus = [];
		string[] lines = lspci_output.Split('\n');
		
		foreach (string line in lines)
		{
			if (line.Contains("VGA compatible controller") || line.Contains("3D controller"))
			{
				string gpu_line = line.Split(':', 2)[1].Trim();
				string vendor = ExtractVendor(gpu_line);
				
				gpus.Add(new GpuInfo
				{
					Name = gpu_line,
					Vendor = vendor
				});
			}
		}
		
		return gpus.Count > 0 ? gpus.ToArray() : [new GpuInfo { Name = "Unknown", Vendor = "Unknown" }];
	}

	private static GpuInfo[] GetMacGpuInfo()
	{
		string system_profiler_output = RunCommand("system_profiler", "SPDisplaysDataType");
		
		if (string.IsNullOrEmpty(system_profiler_output))
			return [new GpuInfo { Name = "Unknown", Vendor = "Unknown" }];

		List<GpuInfo> gpus = [];
		string[] lines = system_profiler_output.Split('\n');
		
		foreach (string line in lines)
		{
			string trimmed_line = line.Trim();
			if (trimmed_line.Contains("Chipset Model:"))
			{
				string gpu_name = trimmed_line.Split(':', 2)[1].Trim();
				string vendor = ExtractVendor(gpu_name);
				
				gpus.Add(new GpuInfo
				{
					Name = gpu_name,
					Vendor = vendor
				});
			}
		}
		
		return gpus.Count > 0 ? [.. gpus] : [new GpuInfo { Name = "Unknown", Vendor = "Unknown" }];
	}

	private static string ExtractVendor(string gpu_name)
	{
		string lower_name = gpu_name.ToLowerInvariant();
		
		if (lower_name.Contains("nvidia") || lower_name.Contains("geforce") || lower_name.Contains("quadro") || lower_name.Contains("tesla"))
			return "NVIDIA";

		if (lower_name.Contains("amd") || lower_name.Contains("radeon") || lower_name.Contains("ati"))
			return "AMD";

		if (lower_name.Contains("intel"))
			return "Intel";

		if (lower_name.Contains("apple"))
			return "Apple";

		return "Unknown";
	}

	private static string RunCommand(string command, string arguments)
	{
		try
		{
			ProcessStartInfo start_info = new()
			{
				FileName = command,
				Arguments = arguments,
				UseShellExecute = false,
				RedirectStandardOutput = true,
				CreateNoWindow = true
			};

			using Process process = Process.Start(start_info)!;
			using StreamReader reader = process.StandardOutput;
			string output = reader.ReadToEnd();
			process.WaitForExit();
			
			return output;
		}
		catch
		{
			return string.Empty;
		}
	}
}

public class CpuInfo
{
	public string Name { get; set; } = "Unknown";
	public int MaxClockSpeed { get; set; } = 0;
	public int Cores { get; set; } = 0;
	public int LogicalProcessors { get; set; } = 0;
}

public class GpuInfo
{
	public string Name { get; set; } = "Unknown";
	public string Vendor { get; set; } = "Unknown";
	public long Vram { get; set; } = 0;
	public string? VideoProcessor { get; set; }
}