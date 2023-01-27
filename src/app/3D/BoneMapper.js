/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

// Retrieved from https://wowdev.wiki/M2#Key_Bone_Names
const BONE_NAMES = {
	0: 'ArmL',
	1: 'ArmR',
	2: 'ShoulderL',
	3: 'ShoulderR',
	4: 'SpineLow',
	5: 'Waist',
	6: 'Head',
	7: 'Jaw',
	8: 'IndexFingerR',
	9: 'MiddleFingerR',
	10: 'PinkyFingerR',
	11: 'RingFingerR',
	12: 'ThumbR',
	13: 'IndexFingerL',
	14: 'MiddleFingerL',
	15: 'PinkyFingerL',
	16: 'RingFingerL',
	17: 'ThumbL',
	18: '$BTH',
	19: '$CSR',
	20: '$CSL',
	21: '_Breath',
	22: '_Name',
	23: '_NameMount',
	24: '$CHD',
	25: '$CCH',
	26: 'Root',
	27: 'Wheel1',
	28: 'Wheel2',
	29: 'Wheel3',
	30: 'Wheel4',
	31: 'Wheel5',
	32: 'Wheel6',
	33: 'Wheel7',
	34: 'Wheel8',
	35: 'FaceAttenuation',
	36: 'CapeParent',
	37: 'CapeChild1',
	38: 'CapeChild2',
	39: 'CapeChild3',
	40: 'CapeChild4',
	43: 'TabardParent',
	44: 'TabardChild1',
	45: 'TabardChild2',
	46: 'UnkHeadTop1',
	47: 'UnkHeadTop2',
	48: 'UpperBodyParent',
	49: 'NeckParent',
	50: 'NeckChild1',
	51: 'LowerBodyParent',
	52: 'Buckle',
	53: 'Chest',
	54: 'Main',
	55: 'LegR',
	56: 'LegL',
	57: 'KneeR',
	58: 'KneeL',
	59: 'FootL',
	60: 'FootR',
	61: 'ElbowR',
	62: 'ElbowL',
	63: 'Unk_ElbowL_Child',
	64: 'HandR',
	65: 'HandL',
	66: 'WeaponR',
	67: 'WeaponL',
	68: 'Unk_WristL_Child',
	69: 'Unk_WristR_Child',
	70: 'KneeR_UpperRig',
	71: 'KneeL_UpperRig',
	72: 'ArmR_2',
	73: 'ArmL_2',
	74: 'ElbowR_UpperRig',
	75: 'ElbowL_UpperRig',
	76: 'ForearmR',
	77: 'ForearmL',
	78: 'WristR_UpperRig',
	79: 'WristL_UpperRig'
};

/**
 * Get the label for a bone.
 * @param {number} index
 */
const getBoneName = (index) => {
	if (index in BONE_NAMES)
		return BONE_NAMES[index];
	else
		return 'Bone' + index;
};

module.exports = { getBoneName };