const WMOVertexShader = {
    None: -1,
    MapObjDiffuse_T1: 0,
    MapObjDiffuse_T1_Refl: 1,
    MapObjDiffuse_T1_Env_T2: 2,
    MapObjSpecular_T1: 3,
    MapObjDiffuse_Comp: 4,
    MapObjDiffuse_Comp_Refl: 5,
    MapObjDiffuse_Comp_Terrain: 6,
    MapObjDiffuse_CompAlpha: 7,
    MapObjParallax: 8
};

const WMOPixelShader = {
    None: -1,
    MapObjDiffuse: 0,
    MapObjSpecular: 1,
    MapObjMetal: 2,
    MapObjEnv: 3,
    MapObjOpaque: 4,
    MapObjEnvMetal: 5,
    MapObjTwoLayerDiffuse: 6,
    MapObjTwoLayerEnvMetal: 7,
    MapObjTwoLayerTerrain: 8,
    MapObjDiffuseEmissive: 9,
    MapObjMaskedEnvMetal: 10,
    MapObjEnvMetalEmissive: 11,
    MapObjTwoLayerDiffuseOpaque: 12,
    MapObjTwoLayerDiffuseEmissive: 13,
    MapObjAdditiveMaskedEnvMetal: 14,
    MapObjTwoLayerDiffuseMod2x: 15,
    MapObjTwoLayerDiffuseMod2xNA: 16,
    MapObjTwoLayerDiffuseAlpha: 17,
    MapObjLod: 18,
    MapObjParallax: 19,
    MapObjDFShader: 20
};


const MOMTShader = {
    Diffuse: 0,
    Specular: 1,
    Metal: 2,
    Env: 3,
    Opaque: 4,
    EnvMetal: 5,
    TwoLayerDiffuse: 6,
    TwoLayerEnvMetal: 7,
    TwoLayerTerrain: 8,
    DiffuseEmissive: 9,
    WaterWindow: 10,
    MaskedEnvMetal: 11,
    EnvMetalEmissive: 12,
    TwoLayerDiffuseOpaque: 13,
    SubmarineWindow: 14,
    TwoLayerDiffuseEmissive: 15,
    DiffuseTerrain: 16,
    AdditiveMaskedEnvMetal: 17,
    TwoLayerDiffuseMod2x: 18,
    TwoLayerDiffuseMod2xNA: 19,
    TwoLayerDiffuseAlpha: 20,
    Lod: 21,
    Parallax: 22,
    DF_MoreTexture_Unknown: 23
};

const WMOShaderMap = {
    [MOMTShader.Diffuse]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1, PixelShader: WMOPixelShader.MapObjDiffuse },
    [MOMTShader.Specular]: { VertexShader: WMOVertexShader.MapObjSpecular_T1, PixelShader: WMOPixelShader.MapObjSpecular },
    [MOMTShader.Metal]: { VertexShader: WMOVertexShader.MapObjSpecular_T1, PixelShader: WMOPixelShader.MapObjMetal },
    [MOMTShader.Env]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1_Refl, PixelShader: WMOPixelShader.MapObjEnv },
    [MOMTShader.Opaque]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1, PixelShader: WMOPixelShader.MapObjOpaque },
    [MOMTShader.EnvMetal]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1_Refl, PixelShader: WMOPixelShader.MapObjEnvMetal },
    [MOMTShader.TwoLayerDiffuse]: { VertexShader: WMOVertexShader.MapObjDiffuse_Comp, PixelShader: WMOPixelShader.MapObjTwoLayerDiffuse },
    [MOMTShader.TwoLayerEnvMetal]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1, PixelShader: WMOPixelShader.MapObjTwoLayerEnvMetal },
    [MOMTShader.TwoLayerTerrain]: { VertexShader: WMOVertexShader.MapObjDiffuse_Comp_Terrain, PixelShader: WMOPixelShader.MapObjTwoLayerTerrain },
    [MOMTShader.DiffuseEmissive]: { VertexShader: WMOVertexShader.MapObjDiffuse_Comp, PixelShader: WMOPixelShader.MapObjDiffuseEmissive },
    [MOMTShader.WaterWindow]: { VertexShader: WMOVertexShader.None, PixelShader: WMOPixelShader.None },
    [MOMTShader.MaskedEnvMetal]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1_Env_T2, PixelShader: WMOPixelShader.MapObjMaskedEnvMetal },
    [MOMTShader.EnvMetalEmissive]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1_Env_T2, PixelShader: WMOPixelShader.MapObjEnvMetalEmissive },
    [MOMTShader.TwoLayerDiffuseOpaque]: { VertexShader: WMOVertexShader.MapObjDiffuse_Comp, PixelShader: WMOPixelShader.MapObjTwoLayerDiffuseOpaque },
    [MOMTShader.SubmarineWindow]: { VertexShader: WMOVertexShader.None, PixelShader: WMOPixelShader.None },
    [MOMTShader.TwoLayerDiffuseEmissive]: { VertexShader: WMOVertexShader.MapObjDiffuse_Comp, PixelShader: WMOPixelShader.MapObjTwoLayerDiffuseEmissive },
    [MOMTShader.DiffuseTerrain]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1, PixelShader: WMOPixelShader.MapObjDiffuse },
    [MOMTShader.AdditiveMaskedEnvMetal]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1_Env_T2, PixelShader: WMOPixelShader.MapObjAdditiveMaskedEnvMetal },
    [MOMTShader.TwoLayerDiffuseMod2x]: { VertexShader: WMOVertexShader.MapObjDiffuse_CompAlpha, PixelShader: WMOPixelShader.MapObjTwoLayerDiffuseMod2x },
    [MOMTShader.TwoLayerDiffuseMod2xNA]: { VertexShader: WMOVertexShader.MapObjDiffuse_Comp, PixelShader: WMOPixelShader.MapObjTwoLayerDiffuseMod2xNA },
    [MOMTShader.TwoLayerDiffuseAlpha]: { VertexShader: WMOVertexShader.MapObjDiffuse_CompAlpha, PixelShader: WMOPixelShader.MapObjTwoLayerDiffuseAlpha },
    [MOMTShader.Lod]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1, PixelShader: WMOPixelShader.MapObjLod },
    [MOMTShader.Parallax]: { VertexShader: WMOVertexShader.MapObjParallax, PixelShader: WMOPixelShader.MapObjParallax },
    [MOMTShader.DF_MoreTexture_Unknown]: { VertexShader: WMOVertexShader.MapObjDiffuse_T1, PixelShader: WMOPixelShader.MapObjDFShader }
};

module.exports = { MOMTShader, WMOVertexShader, WMOPixelShader, WMOShaderMap };
