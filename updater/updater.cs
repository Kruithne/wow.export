using System.Diagnostics;

namespace wow_export;

public partial class Program
{
	private const int MAX_LOCK_TRIES = 30;
	private static readonly List<string> log_output = [];

	public static void Main(string[] args)
	{
		try
		{
			Log("Updater has started.");

			string? parent_process_name = null;
			
			for (int i = 0; i < args.Length; i++)
			{
				if (args[i].StartsWith("--parent="))
				{
					parent_process_name = args[i].Substring(9);
					break;
				}
			}

			if (string.IsNullOrEmpty(parent_process_name))
			{
				Log("WARN: No parent process name was provided to the updater.");
			}
			else
			{
				Log($"Terminating parent process: {parent_process_name}");
				TerminateProcessesByName(parent_process_name);
			}

			string install_directory = AppContext.BaseDirectory;
			string update_directory = Path.Combine(install_directory, ".update");

			Log($"Install directory: {install_directory}");
			Log($"Update directory: {update_directory}");

			if (Directory.Exists(update_directory))
				ApplyUpdate(update_directory, install_directory);
			else
				Log("WARN: Update directory does not exist. No update to apply.");

			if (!string.IsNullOrEmpty(parent_process_name))
				RestartProcess(parent_process_name, install_directory);

			Log("Removing update files...");
			if (Directory.Exists(update_directory))
				Directory.Delete(update_directory, true);
		}
		catch (Exception ex)
		{
			Log($"ERROR: {ex.Message}");
		}
		finally
		{
			WriteLogFile();
		}
	}

	private static void TerminateProcessesByName(string process_name)
	{
		try
		{
			string process_name_without_extension = Path.GetFileNameWithoutExtension(process_name);
			
			Process[] processes = Process.GetProcessesByName(process_name_without_extension);
			foreach (Process process in processes)
			{
				try
				{
					Log($"Terminating process {process.ProcessName} (PID: {process.Id})");
					process.Kill();
					process.WaitForExit(5000);
				}
				catch (Exception ex)
				{
					Log($"WARN: Failed to terminate process {process.ProcessName}: {ex.Message}");
				}
			}

			string command = OperatingSystem.IsWindows() 
				? $"taskkill /f /im {process_name}"
				: $"pkill {process_name_without_extension}";

			Log($"Sending auxiliary termination command ({Environment.OSVersion.Platform}): {command}");
			
			using Process cmd_process = new()
			{
				StartInfo = new ProcessStartInfo
				{
					FileName = OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/sh",
					Arguments = OperatingSystem.IsWindows() ? $"/c {command}" : $"-c \"{command}\"",
					UseShellExecute = false,
					CreateNoWindow = true
				}
			};
			
			cmd_process.Start();
			cmd_process.WaitForExit(5000);
		}
		catch (Exception ex)
		{
			Log($"WARN: Failed to terminate processes: {ex.Message}");
		}
	}

	private static void ApplyUpdate(string update_directory, string install_directory)
	{
		try
		{
			string[] update_files = Directory.GetFiles(update_directory, "*", SearchOption.AllDirectories);
			
			foreach (string file in update_files)
			{
				string relative_path = Path.GetRelativePath(update_directory, file);
				string write_path = Path.Combine(install_directory, relative_path);

				Log($"Applying update file: {write_path}");

				try
				{
					bool is_locked = File.Exists(write_path) && IsFileLocked(write_path);
					int tries = 0;

					while (is_locked && tries < MAX_LOCK_TRIES)
					{
						tries++;
						Log($"File is locked, waiting... (attempt {tries}/{MAX_LOCK_TRIES})");
						Thread.Sleep(1000);
						is_locked = IsFileLocked(write_path);
					}

					if (is_locked)
					{
						Log($"WARN: File was locked, MAX_LOCK_TRIES exceeded: {write_path}");
						continue;
					}

					Directory.CreateDirectory(Path.GetDirectoryName(write_path)!);
					File.Copy(file, write_path, true);
				}
				catch (Exception ex)
				{
					Log($"WARN: Failed to apply update file {write_path}: {ex.Message}");
				}
			}
		}
		catch (Exception ex)
		{
			Log($"ERROR: Failed to apply update: {ex.Message}");
		}
	}

	private static bool IsFileLocked(string file_path)
	{
		try
		{
			using FileStream stream = File.Open(file_path, FileMode.Open, FileAccess.Write, FileShare.None);
			return false;
		}
		catch (IOException)
		{
			return true;
		}
	}

	private static void RestartProcess(string process_name, string install_directory)
	{
		try
		{
			string executable_path = Path.Combine(install_directory, process_name);
			
			if (!File.Exists(executable_path))
			{
				Log($"WARN: Executable not found for restart: {executable_path}");
				return;
			}

			Log($"Re-launching main process: {executable_path}");

			using Process restart_process = new()
			{
				StartInfo = new ProcessStartInfo
				{
					FileName = executable_path,
					UseShellExecute = false,
					CreateNoWindow = false,
					WorkingDirectory = install_directory
				}
			};

			restart_process.Start();
		}
		catch (Exception ex)
		{
			Log($"ERROR: Failed to restart process: {ex.Message}");
		}
	}

	private static void Log(string message)
	{
		string timestamp = DateTime.Now.ToString("HH:mm:ss");
		string log_entry = $"[{timestamp}] {message}";
		log_output.Add(log_entry);
		Console.WriteLine(log_entry);
	}

	private static void WriteLogFile()
	{
		try
		{
			string log_directory = Path.Combine(AppContext.BaseDirectory, "logs");
			Directory.CreateDirectory(log_directory);

			string log_filename = $"{DateTimeOffset.Now.ToUnixTimeSeconds()}-update.log";
			string log_path = Path.Combine(log_directory, log_filename);

			File.WriteAllText(log_path, string.Join(Environment.NewLine, log_output));
		}
		catch (Exception ex)
		{
			Console.WriteLine($"Failed to write log file: {ex.Message}");
		}
	}
}