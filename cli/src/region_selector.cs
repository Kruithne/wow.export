namespace wow_export;

public static class RegionSelector
{
	private static CDNRegionData[]? _available_regions;
	private static CDNRegionData? _selected_region;
	
	public static void SetAvailableRegions(CDNRegionData[] regions)
	{
		_available_regions = regions;
	}
	
	public static CDNRegionData? GetSelectedRegion()
	{
		return _selected_region;
	}
	
	public static void SelectRegion()
	{
		if (_available_regions == null || _available_regions.Length == 0)
		{
			Log.Error("No regions available for selection");
			return;
		}
		
		string? specified_region = CLIFlags.Get(CLIFlag.CDN_REGION);
		
		if (specified_region != null)
		{
			foreach (CDNRegionData region in _available_regions)
			{
				if (region.id == specified_region)
				{
					_selected_region = region;
					Log.Success($"Selected region: {region.display_name}");
					return;
				}
			}
			
			Log.Error($"Region '{specified_region}' not found in available regions");
			return;
		}
		
		MenuOption[] menu_options = new MenuOption[_available_regions.Length];
		for (int i = 0; i < _available_regions.Length; i++)
		{
			CDNRegionData region = _available_regions[i];
			menu_options[i] = new DynamicMenuOption(region.id, region.display_name, region);
		}
		
		MenuOption selected_option = Log.GetUserInput("Select a CDN region:", menu_options);
		if (selected_option is DynamicMenuOption dynamic_option)
			_selected_region = (CDNRegionData?)dynamic_option.Data;
		
		if (_selected_region.HasValue)
			Log.Success($"Selected region: {_selected_region.Value.display_name}");
	}
}