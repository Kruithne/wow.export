namespace wow_export;

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