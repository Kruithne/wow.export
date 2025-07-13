using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace wow_export;

public partial class Log
{
	private static string? _last_prefix = null;
	private static readonly StreamWriter _log_stream;
	
	static Log()
	{
		EnableAnsiColors();
		
		try
		{
			IO.CreateDirectory(IO.AppDataDirectory);
			string log_file_path = Path.Combine(IO.AppDataDirectory, "runtime.log");
			_log_stream = new StreamWriter(log_file_path, append: false) { AutoFlush = true };
		}
		catch (Exception ex)
		{
			_log_stream = StreamWriter.Null;
			Error($"Failed to create runtime log file: *{ex.Message}*");
		}
	}
	
	public static class Colors
	{
		public const string Reset = "\x1b[0m";
		public const string Black = "\x1b[30m";
		
		public static (byte r, byte g, byte b) ParseHexColor(string hex)
		{
			hex = hex.TrimStart('#');
			
			if (hex.Length == 3)
			{
				var r = Convert.ToByte(hex[0].ToString() + hex[0].ToString(), 16);
				var g = Convert.ToByte(hex[1].ToString() + hex[1].ToString(), 16);
				var b = Convert.ToByte(hex[2].ToString() + hex[2].ToString(), 16);
				return (r, g, b);
			}
			else if (hex.Length == 6)
			{
				var r = Convert.ToByte(hex[0..2], 16);
				var g = Convert.ToByte(hex[2..4], 16);
				var b = Convert.ToByte(hex[4..6], 16);
				return (r, g, b);
			}
			
			throw new ArgumentException("Invalid hex color format. Use #RGB or #RRGGBB");
		}

		public static string HexToAnsi(string hex_color, bool is_background = false)
		{
			var (r, g, b) = ParseHexColor(hex_color);
			var code = is_background ? 48 : 38;
			return $"\x1b[{code};2;{r};{g};{b}m";
		}

		public static string HexToAnsiBg(string hex_color)
		{
			return HexToAnsi(hex_color, true);
		}
	}

	public static void EnableAnsiColors()
	{
		if (!OperatingSystem.IsWindows())
			return;
		
		try
		{
			var handle = GetStdHandle(-11); // STD_OUTPUT_HANDLE
			GetConsoleMode(handle, out uint mode);
			SetConsoleMode(handle, mode | 0x0004); // ENABLE_VIRTUAL_TERMINAL_PROCESSING
		}
		catch
		{
			// unsupported
		}
	}
	
	[LibraryImport("kernel32.dll")]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static partial bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
	
	[LibraryImport("kernel32.dll")]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static partial bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
	
	[LibraryImport("kernel32.dll", SetLastError = true)]
	private static partial IntPtr GetStdHandle(int nStdHandle);

	[GeneratedRegex(@"\*([^*]+)\*")]
	private static partial Regex GetHighlightRegex();
	
	[GeneratedRegex(@"\x1b\[[0-9;]*m")]
	private static partial Regex GetAnsiColorRegex();
	
	private static string StripAnsiColors(string text)
	{
		return GetAnsiColorRegex().Replace(text, string.Empty);
	}
	
	private static void WriteOutput(string message)
	{
		if (CLIFlags.GetContext() == CLIContext.CLI)
			Console.WriteLine(message);
		WriteLog(StripAnsiColors(message));
	}
	
	private static void WriteLog(string message)
	{
		try
		{
			_log_stream.WriteLine(message);
		}
		catch
		{
			// prevent crash on log failure
		}
	}

	public static Action<string, string?> CreateLogger(string default_prefix, string prefix_color)
	{
		string prefix_bg = Colors.HexToAnsiBg(prefix_color);
		string prefix_fg = Colors.HexToAnsi(prefix_color);
		
		return (message, custom_prefix) =>
		{
			string actual_prefix = custom_prefix != null ? PadPrefix(custom_prefix) : default_prefix;
			
			string highlighted_message = GetHighlightRegex().Replace(message, match =>
			{
				string content = match.Groups[1].Value;
				return $"{prefix_fg}{content}{Colors.Reset}";
			});
			
			bool is_tree_symbol = _last_prefix == actual_prefix;
			_last_prefix = actual_prefix;
			
			if (is_tree_symbol)
			{
				string spacing = " ".PadRight(actual_prefix.Length);
				string tree_char = "├".PadLeft((actual_prefix.Length + 1) / 2).PadRight(actual_prefix.Length);
				int tree_pos = tree_char.IndexOf('├');
				string before_tree = tree_char[..tree_pos];
				string after_tree = tree_char[(tree_pos + 1)..];
				
				WriteOutput($" {before_tree}{prefix_fg}├{Colors.Reset}{after_tree}  {highlighted_message}");
			}
			else
			{
				WriteOutput($"{prefix_bg}{Colors.Black} {actual_prefix} {Colors.Reset} {highlighted_message}");
			}
		};
	}

	private static readonly Action<string, string?> _info_logger = CreateLogger("INFO", "#3498db");
	private static readonly Action<string, string?> _success_logger = CreateLogger("DONE", "#2ecc71");
	private static readonly Action<string, string?> _error_logger = CreateLogger("ERR!", "#e74c3c");
	private static readonly Action<string, string?> _warn_logger = CreateLogger("WARN", "#f39c12");
	private static readonly Action<string, string?> _user_logger = CreateLogger("USER", "#9b59b6");
	
	private static readonly string _user_prefix_bg = Colors.HexToAnsiBg("#9b59b6");
	private static readonly string _user_prefix_fg = Colors.HexToAnsi("#9b59b6");

	private static string PadPrefix(string prefix)
	{
		return prefix.Length >= 4 ? prefix : prefix.PadRight(4);
	}

	public static void Info(string message, string? custom_prefix = null)
	{
		_info_logger(message, custom_prefix);
	}

	public static void Success(string message, string? custom_prefix = null)
	{
		_success_logger(message, custom_prefix);
	}

	public static void Error(string message, string? custom_prefix = null)
	{
		_error_logger(message, custom_prefix);
	}

	public static void Warn(string message, string? custom_prefix = null)
	{
		_warn_logger(message, custom_prefix);
	}

	public static void User(string message, string? custom_prefix = null)
	{
		_user_logger(message, custom_prefix);
	}

	public static string GetUserInput(string prompt)
	{
		string highlighted_prompt = GetHighlightRegex().Replace(prompt, match =>
		{
			string content = match.Groups[1].Value;
			return $"{_user_prefix_fg}{content}{Colors.Reset}";
		});
		
		string console_output = $"{_user_prefix_bg}{Colors.Black} USER {Colors.Reset} {highlighted_prompt} > ";
		
		if (CLIFlags.GetContext() == CLIContext.CLI)
			Console.Write(console_output);
		WriteLog($" USER  {StripAnsiColors(highlighted_prompt)} > ");
		
		string? user_input = Console.ReadLine() ?? string.Empty;
		WriteLog(user_input);
		
		return user_input;
	}
	
	public static T GetUserInput<T>(string prompt, T[] options) where T : MenuOption
	{
		while (true)
		{
			User(prompt);
			
			for (int i = 0; i < options.Length; i++)
			{
				T option = options[i];
				User($"{i + 1}. {option.DisplayName} ({option.Id})");
			}
			
			string console_prompt = $"{_user_prefix_bg}{Colors.Black} USER {Colors.Reset} > ";
			
			if (CLIFlags.GetContext() == CLIContext.CLI)
				Console.Write(console_prompt);
			WriteLog(" USER  > ");
			
			string? input = Console.ReadLine();
			WriteLog(input ?? string.Empty);
			
			if (string.IsNullOrEmpty(input))
			{
				Error("Please enter a valid selection.");
				Blank();
				continue;
			}
			
			if (!int.TryParse(input, out int selection) || selection < 1 || selection > options.Length)
			{
				Error($"Please enter a number between 1 and {options.Length}.");
				Blank();
				continue;
			}
			
			return options[selection - 1];
		}
	}

	public static void Blank()
	{
		_last_prefix = null;
		WriteOutput(string.Empty);
	}
}

public abstract class MenuOption(string id, string display_name)
{
	public string Id { get; protected set; } = id;
	public string DisplayName { get; protected set; } = display_name;

	public static DynamicMenuOption Create(string id, string display_name, object? data = null)
	{
		return new DynamicMenuOption(id, display_name, data);
	}
	
	public static DynamicMenuOption[] CreateList(string[] ids, string[] display_names, object[]? data = null)
	{
		if (ids.Length != display_names.Length)
			throw new ArgumentException("ids and display_names arrays must have the same length");
		
		if (data != null && data.Length != ids.Length)
			throw new ArgumentException("data array must have the same length as ids array");
		
		DynamicMenuOption[] options = new DynamicMenuOption[ids.Length];
		for (int i = 0; i < ids.Length; i++)
		{
			object? item_data = data?[i];
			options[i] = new DynamicMenuOption(ids[i], display_names[i], item_data);
		}
		
		return options;
	}
}

public class DynamicMenuOption(string id, string display_name, object? data = null) : MenuOption(id, display_name)
{
	public object? Data { get; private set; } = data;
}