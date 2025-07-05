using System.ComponentModel;
using System.Reflection;

namespace wow_export;

public enum CLIFlag
{
	[Description("Show this help message")]
	HELP,
	
	[Description("Enable experimental feature B")]
	USE_FEATURE_B,
	
	[Description("Set operation mode (accepts value)")]
	SOME_MODE,
	
	[Description("Select CDN region (eu, us, kr, cn, tw)")]
	CDN_REGION
}

public static class CLIFlags
{
	private static readonly Dictionary<CLIFlag, string?> _parsed_flags = new();
	
	static CLIFlags()
	{			
		string[] args = Environment.GetCommandLineArgs();
		
		// skip executable path
		for (int i = 1; i < args.Length; i++)
		{
			string arg = args[i];
			
			if (!arg.StartsWith("--"))
				continue;
				
			string flag_text = arg[2..]; // remove "--" prefix
			string? flag_name;
			string? flag_value;
			
			int equals_index = flag_text.IndexOf('=');
			if (equals_index >= 0)
			{
				flag_name = flag_text[..equals_index];
				flag_value = flag_text[(equals_index + 1)..];
			}
			else
			{
				flag_name = flag_text;
				flag_value = "true";
			}
			
			string enum_name = flag_name.Replace('-', '_').ToUpperInvariant();
			
			if (Enum.TryParse<CLIFlag>(enum_name, out CLIFlag flag))
				_parsed_flags[flag] = flag_value;
		}
	}
	
	public static bool Has(CLIFlag flag)
	{
		return _parsed_flags.ContainsKey(flag);
	}
	
	public static string? Get(CLIFlag flag)
	{
		return _parsed_flags.TryGetValue(flag, out string? value) ? value : null;
	}
	
	public static void PrintHelp()
	{
		Log.Info("Usage: wow_export_cli [flags]", "HELP");
		Log.Blank();
		Log.Info("Flags:", "HELP");
		
		foreach (CLIFlag flag in Enum.GetValues<CLIFlag>())
		{
			string flag_name = GetFlagName(flag);
			string description = GetFlagDescription(flag);
			
			string formatted_flag = $"  *--{flag_name}*";
			
			int padding = Math.Max(25 - formatted_flag.Length + 2, 2);
			string spaces = new(' ', padding);
			
			Log.Info($"{formatted_flag}{spaces}{description}", "HELP");
		}
		
		Log.Blank();
	}
	
	private static string GetFlagName(CLIFlag flag)
	{
		return flag.ToString().ToLowerInvariant().Replace('_', '-');
	}
	
	private static string GetFlagDescription(CLIFlag flag)
	{
		FieldInfo? field_info = typeof(CLIFlag).GetField(flag.ToString());
		object[]? attributes = field_info?.GetCustomAttributes(typeof(DescriptionAttribute), false);
		
		if (attributes != null && attributes.Length > 0)
		{
			DescriptionAttribute description_attribute = (DescriptionAttribute)attributes[0];
			return description_attribute.Description;
		}
		
		return "No description available";
	}
}