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
		
		string[] region_ids = new string[_available_regions.Length];
		for (int i = 0; i < _available_regions.Length; i++)
			region_ids[i] = $"*{_available_regions[i].id}*";
			
		string available_regions_formatted = string.Join(", ", region_ids);

		Log.Error("The *--cdn-region* flag is required.");
		Log.Info($"Available regions: {available_regions_formatted}");
		throw new Exception("CDN region not specified");
	}
}