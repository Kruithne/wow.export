const DBItems = require('../db/caches/DBItems');
const { get_slot_name, SHOULDER_SLOT_L, SHOULDER_SLOT_R } = require('./EquipmentSlots');

const equip_item = (core, item, pending_slot) => {
	const slot_id = DBItems.getItemSlotId(item.id);
	if (!slot_id)
		return false;

	let slot_ids;
	if (slot_id === SHOULDER_SLOT_L) {
		const target = (pending_slot === SHOULDER_SLOT_L || pending_slot === SHOULDER_SLOT_R) ? pending_slot : SHOULDER_SLOT_L;
		const other = target === SHOULDER_SLOT_L ? SHOULDER_SLOT_R : SHOULDER_SLOT_L;

		slot_ids = [target];
		if (!core.view.chrEquippedItems[other])
			slot_ids.push(other);
	} else {
		slot_ids = [slot_id];
	}

	for (const sid of slot_ids) {
		core.view.chrEquippedItems[sid] = item.id;
		delete core.view.chrEquippedItemSkins[sid];
	}

	core.view.chrEquippedItems = { ...core.view.chrEquippedItems };
	core.view.chrEquippedItemSkins = { ...core.view.chrEquippedItemSkins };

	const equip_slot_name = get_slot_name(slot_ids.length === 1 ? slot_ids[0] : slot_id);
	core.setToast('success', `Equipped ${item.name} to ${equip_slot_name} slot.`, null, 2000);
	return true;
};

module.exports = { equip_item };
