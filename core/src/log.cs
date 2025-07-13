namespace wow_export;

public class Log
{
	private static readonly StreamWriter _log_stream;
	
	static Log()
	{
		try
		{
			IO.CreateDirectory(IO.AppDataDirectory);
			string log_file_path = Path.Combine(IO.AppDataDirectory, "runtime.log");
			_log_stream = new StreamWriter(log_file_path, append: false) { AutoFlush = true };
		}
		catch
		{
			_log_stream = StreamWriter.Null;
		}
	}
	
	public static void Write(string message)
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

	public static void Blank()
	{
		Write(string.Empty);
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