/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */

const log = require('../log');

const SHADER_ARRAY = [
	{ "PS": "Combiners_Opaque_Mod2xNA_Alpha",           "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_AddAlpha",                "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_AddAlpha_Alpha",          "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_Mod2xNA_Alpha_Add",       "VS": "Diffuse_T1_Env_T1",      "HS": "T1_T2_T3", "DS": "T1_T2_T3"  },
	{ "PS": "Combiners_Mod_AddAlpha",                   "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_AddAlpha",                "VS": "Diffuse_T1_T1",          "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod_AddAlpha",                   "VS": "Diffuse_T1_T1",          "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod_AddAlpha_Alpha",             "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_Alpha_Alpha",             "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_Mod2xNA_Alpha_3s",        "VS": "Diffuse_T1_Env_T1",      "HS": "T1_T2_T3", "DS": "T1_T2_T3"  },
	{ "PS": "Combiners_Opaque_AddAlpha_Wgt",            "VS": "Diffuse_T1_T1",          "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod_Add_Alpha",                  "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_ModNA_Alpha",             "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod_AddAlpha_Wgt",               "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod_AddAlpha_Wgt",               "VS": "Diffuse_T1_T1",          "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_AddAlpha_Wgt",            "VS": "Diffuse_T1_T2",          "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_Mod_Add_Wgt",             "VS": "Diffuse_T1_Env",         "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha", "VS": "Diffuse_T1_Env_T1",      "HS": "T1_T2_T3", "DS": "T1_T2_T3"  },
	{ "PS": "Combiners_Mod_Dual_Crossfade",             "VS": "Diffuse_T1",             "HS": "T1",       "DS": "T1"        },
	{ "PS": "Combiners_Mod_Depth",                      "VS": "Diffuse_EdgeFade_T1",    "HS": "T1",       "DS": "T1"        },
	{ "PS": "Combiners_Opaque_Mod2xNA_Alpha_Alpha",     "VS": "Diffuse_T1_Env_T2",      "HS": "T1_T2_T3", "DS": "T1_T2_T3"  },
	{ "PS": "Combiners_Mod_Mod",                        "VS": "Diffuse_EdgeFade_T1_T2", "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod_Masked_Dual_Crossfade",      "VS": "Diffuse_T1_T2",          "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_Alpha",                   "VS": "Diffuse_T1_T1",          "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha", "VS": "Diffuse_T1_Env_T2",      "HS": "T1_T2_T3", "DS": "T1_T2_T3"  },
	{ "PS": "Combiners_Mod_Depth",                      "VS": "Diffuse_EdgeFade_Env",   "HS": "T1",       "DS": "T1"        },
	{ "PS": "Guild",                                    "VS": "Diffuse_T1_T2_T1",       "HS": "T1_T2_T3", "DS": "T1_T2"     },
	{ "PS": "Guild_NoBorder",                           "VS": "Diffuse_T1_T2",          "HS": "T1_T2",    "DS": "T1_T2_T3"  },
	{ "PS": "Guild_Opaque",                             "VS": "Diffuse_T1_T2_T1",       "HS": "T1_T2_T3", "DS": "T1_T2"     },
	{ "PS": "Illum",                                    "VS": "Diffuse_T1_T1",          "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod_Mod_Mod_Const",              "VS": "Diffuse_T1_T2_T3",       "HS": "T1_T2_T3", "DS": "T1_T2_T3"  },
	{ "PS": "Combiners_Mod_Mod_Mod_Const",              "VS": "Color_T1_T2_T3",         "HS": "T1_T2_T3", "DS": "T1_T2_T3"  },
	{ "PS": "Combiners_Opaque",                         "VS": "Diffuse_T1",             "HS": "T1",       "DS": "T1"        },
	{ "PS": "Combiners_Mod_Mod2x",                      "VS": "Diffuse_EdgeFade_T1_T2", "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod",                            "VS": "Diffuse_EdgeFade_T1",    "HS": "T1_T2",    "DS": "T1_T2"     },
	{ "PS": "Combiners_Mod_Mod",                        "VS": "Diffuse_EdgeFade_T1_T2", "HS": "T1_T2",    "DS": "T1_T2"     },
];


/**
 * Gets Vertex shader name from shader ID
 */
const getVertexShader = (textureCount, shaderID) => {
	if (shaderID < 0) {
		const vertexShaderId = shaderID & 0x7FFF;
		if (vertexShaderId >= SHADER_ARRAY.length) {
			log.write("Unknown vertex shader ID: " + vertexShaderId);
			return null;
		}

		return SHADER_ARRAY[vertexShaderId].VS;
	}
	else {
		if (textureCount == 1) {
			if (shaderID & 0x80) {
				return "Diffuse_Env";
			} else {
				if (shaderID & 0x4000)
					return "Diffuse_T2";
				else
					return "Diffuse_T1";
			}
		} else {
			if (shaderID & 0x80) {
				if (shaderID & 0x8)
					return "Diffuse_Env_Env";
				else 
					return "Diffuse_Env_T1";
			} else {
				if (shaderID & 0x8) {
					return "Diffuse_T1_Env";
				} else {
					if (shaderID & 0x4000)
						return "Diffuse_T1_T2";
					else
						return "Diffuse_T1_T1";
				}
			}
		}
	}
};

/**
 * Gets Pixel shader name from shader ID
 */
const getPixelShader = (textureCount, shaderID) => {
	if (shaderID & 0x8000) {
		const pixelShaderID = shaderID & 0x7FFF;
		if (pixelShaderID >= SHADER_ARRAY.length) {
			log.write("Unknown pixel shader ID: " + pixelShaderID);
			return null;
		}

		return SHADER_ARRAY[pixelShaderID].PS;
	}
	else if (textureCount == 1)
	{
		return (shaderID & 0x70) ? "Combiners_Mod" : "Combiners_Opaque";
	}
	else 
	{
		if (shaderID & 0x70) {
			switch (shaderID & 7) {
				case 3:
					return "Combiners_Mod_Add";
				case 4:
					return "Combiners_Mod_Mod2x";
				case 6:
					return "Combiners_Mod_Mod2xNA";
				case 7:
					return "Combiners_Mod_AddNA";
				default:
					return "Combiners_Mod_Mod";
			}
		}
		else {
			switch (shaderID & 7) {
				case 0:
					return "Combiners_Opaque_Opaque";
				case 3:
				case 7:
					return "Combiners_Opaque_AddAlpha";
				case 4:
					return "Combiners_Opaque_Mod2x";
				case 6:
					return "Combiners_Opaque_Mod2xNA";
				default:
					return "Combiners_Opaque_Mod";
			}
		}
	}
};

/**
 * Gets Hull shader name from shader ID
 */
const getHullShader = (textureCount, shaderID) => {
	if (shaderID & 0x8000) {
		const hullShaderID = shaderID & 0x7FFF;
		if (hullShaderID >= SHADER_ARRAY.length) {
			log.write("Unknown hull shader ID: " + hullShaderID);
			return null;
		}

		return SHADER_ARRAY[hullShaderID].HS;
	} else {
		if (textureCount == 1)
			return "T1";
		else
			return "T1_T2";
	}
}

/**
 * Gets Domain shader name from shader ID
 */
const getDomainShader = (textureCount, shaderID) => {
	if (shaderID & 0x8000) {
		const domainShaderID = shaderID & 0x7FFF;
		if (domainShaderID >= SHADER_ARRAY.length) {
			log.write("Unknown domain shader ID: " + domainShaderID);
			return null;
		}

		return SHADER_ARRAY[domainShaderID].DS;
	} else {
		if (textureCount == 1)
			return "T1";
		else
			return "T1_T2";
	}
}
	

module.exports = { getVertexShader, getPixelShader, getHullShader, getDomainShader };