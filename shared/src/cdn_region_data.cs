namespace wow_export;

public struct CDNRegionData
{
	public string id;
	public string display_name;
	public string patch_host_template;
	public string ribbit_host_template;
	
	public static CDNRegionData Create(string id, string display_name, string patch_host, string ribbit_host)
	{
		return new CDNRegionData
		{
			id = id,
			display_name = display_name,
			patch_host_template = patch_host,
			ribbit_host_template = ribbit_host
		};
	}
	
	public static readonly CDNRegionData[] ALL_REGIONS = 
	[
		Create("us", "America", "us.patch.battle.net", "us.version.battle.net"),
		Create("eu", "Europe", "eu.patch.battle.net", "eu.version.battle.net"),
		Create("kr", "Korea", "kr.patch.battle.net", "kr.version.battle.net"),
		Create("cn", "China", "cn.patch.battle.net", "cn.version.battle.net"),
		Create("tw", "Taiwan", "tw.patch.battle.net", "tw.version.battle.net")
	];
}