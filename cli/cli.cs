using System.Reflection;

namespace wow_export;

class CLI
{
	static void Main(string[] args)
	{
		var version = Assembly.GetExecutingAssembly().GetName().Version;
		Console.WriteLine($"wow_export_cli v{version}");
	}
}