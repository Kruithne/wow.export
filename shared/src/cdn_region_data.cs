using System.Runtime.InteropServices;
using System.Text;

namespace wow_export;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
public struct CDNRegionData
{
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)]
	public byte[] id_bytes;
	
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
	public byte[] display_name_bytes;
	
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 64)]
	public byte[] patch_host_template_bytes;
	
	[MarshalAs(UnmanagedType.ByValArray, SizeConst = 64)]
	public byte[] ribbit_host_template_bytes;
	
	public string id
	{
		get => IpcStructHelper.GetStringFromByteArray(id_bytes);
		set => IpcStructHelper.CopyStringToByteArray(value, id_bytes ??= new byte[16]);
	}
	
	public string display_name
	{
		get => IpcStructHelper.GetStringFromByteArray(display_name_bytes);
		set => IpcStructHelper.CopyStringToByteArray(value, display_name_bytes ??= new byte[32]);
	}
	
	public string patch_host_template
	{
		get => IpcStructHelper.GetStringFromByteArray(patch_host_template_bytes);
		set => IpcStructHelper.CopyStringToByteArray(value, patch_host_template_bytes ??= new byte[64]);
	}
	
	public string ribbit_host_template
	{
		get => IpcStructHelper.GetStringFromByteArray(ribbit_host_template_bytes);
		set => IpcStructHelper.CopyStringToByteArray(value, ribbit_host_template_bytes ??= new byte[64]);
	}
	
	public static CDNRegionData Create(string id, string display_name, string patch_host, string ribbit_host)
	{
		CDNRegionData data = new()
		{
			id_bytes = new byte[16],
			display_name_bytes = new byte[32],
			patch_host_template_bytes = new byte[64],
			ribbit_host_template_bytes = new byte[64]
		};
		
		data.id = id;
		data.display_name = display_name;
		data.patch_host_template = patch_host;
		data.ribbit_host_template = ribbit_host;
		
		return data;
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