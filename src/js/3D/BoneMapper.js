/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */

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
	36: 'EXP_C1_Cape1',
	37: 'EXP_C1_Cape2',
	38: 'EXP_C1_Cape3',
	39: 'EXP_C1_Cape4',
	40: 'EXP_C1_Cape5',
	43: 'EXP_C1_Tail1',
	44: 'EXP_C1_Tail2',
	45: 'EXP_C1_LoinBk1',
	46: 'EXP_C1_LoinBk2',
	47: 'EXP_C1_LoinBk3',
	48: 'EXP_C1_Spine2',
	49: 'EXP_C1_Neck1',
	50: 'EXP_C1_Neck2',
	51: 'EXP_C1_Pelvis1',
	52: 'Buckle',
	53: 'Chest',
	54: 'Main',
	55: 'EXP_R1_Leg1Twist1',
	56: 'EXP_L1_Leg1Twist1',
	57: 'EXP_R1_Leg2Twist1',
	58: 'EXP_L1_Leg2Twist1',
	59: 'FootL',
	60: 'FootR',
	61: 'ElbowR',
	62: 'ElbowL',
	63: 'EXP_L1_Shield1',
	64: 'HandR',
	65: 'HandL',
	66: 'WeaponR',
	67: 'WeaponL',
	68: 'ESpellHandL',
	69: 'ESpellHandR',
	70: 'EXP_R1_Leg1Twist3',
	71: 'EXP_L1_Leg1Twist3',
	72: 'EXP_R1_Arm1Twist2',
	73: 'EXP_L1_Arm1Twist2',
	74: 'EXP_R1_Arm1Twist3',
	75: 'EXP_L1_Arm1Twist3',
	76: 'EXP_R1_Arm2Twist2',
	77: 'EXP_L1_Arm2Twist2',
	78: 'EXP_R1_Arm2Twist3',
	79: 'EXP_L1_Arm2Twist3',
	80: 'ForearmR',
	81: 'ForearmL',
	82: 'EXP_R1_Arm1Twist1',
	83: 'EXP_L1_Arm1Twist1',
	84: 'EXP_R1_Arm2Twist1',
	85: 'EXP_L1_Arm2Twist1',
	86: 'EXP_R1_FingerClawA1',
	87: 'EXP_R1_FingerClawB1',
	88: 'EXP_L1_FingerClawA1',
	89: 'EXP_L1_FingerClawB1'
};

/**
 * Get the label for a bone.
 * @param {number} index  - The bone index.
 * @returns {string} The bone label.
 */
const getBoneName = (index) => {
	if (index in BONE_NAMES)
		return BONE_NAMES[index];
	else
		return 'Bone' + index;
}

module.exports = { getBoneName };