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

