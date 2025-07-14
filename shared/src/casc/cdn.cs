namespace wow_export;

public class CDNRegion
{
	public string Id { get; private set; }
	public string PatchHost { get; private set; }
	public string RibbitHost { get; private set; }
	
	public CDNRegion(string id, string patch_host, string ribbit_host)
	{
		Id = id;
		PatchHost = patch_host;
		RibbitHost = ribbit_host;
	}
	
	public static CDNRegion FromData(CDNRegionData data)
	{
		return new CDNRegion(data.id, data.patch_host_template, data.ribbit_host_template);
	}
}