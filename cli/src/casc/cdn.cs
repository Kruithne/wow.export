namespace wow_export;

public class CDNRegion : MenuOption
{
	private static readonly string PATCH_HOST_TEMPLATE = "{0}.patch.battle.net";
	private static readonly string RIBBIT_HOST_TEMPLATE = "{0}.version.battle.net";
	
	private CDNRegion(string id, string display_name) : base(id, display_name)
	{
	}
	
	public string GetPatchHost()
	{
		return string.Format(PATCH_HOST_TEMPLATE, Id);
	}
	
	public string GetRibbitHost()
	{
		return string.Format(RIBBIT_HOST_TEMPLATE, Id);
	}
	
	public static readonly CDNRegion US = new("us", "America");
	public static readonly CDNRegion EU = new("eu", "Europe");
	public static readonly CDNRegion KR = new("kr", "Korea");
	public static readonly CDNRegion CN = new("cn", "China");
	public static readonly CDNRegion TW = new("tw", "Taiwan");
	
	public static CDNRegion[] All => [US, EU, KR, CN, TW];
	
	public static CDNRegion? FromId(string id)
	{
		foreach (CDNRegion region in All)
		{
			if (region.Id == id)
				return region;
		}
		return null;
	}
}