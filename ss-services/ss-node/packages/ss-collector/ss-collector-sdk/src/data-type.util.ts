// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Data-type detection utilities - unify the type-string differences between the tag table (DataTag) and the collection pipeline.
 *
 * Background: the canonical string for a tag-table boolean type is 'boolean' (TagDataType.BOOLEAN),
 * but legacy pipeline code checks 'bool', causing boolean points to fall into the numeric branch
 * (the simulator generates 0-100 random numbers, Transform converts to numbers, and spurious limit alarms are injected).
 * All dataType boolean/string checks must go through these helper functions; scattered string-literal comparisons are forbidden.
 */

/** All valid spellings of the tag-table boolean data type */
const BOOLEAN_DATA_TYPES = ['boolean', 'bool'];

/** All valid spellings of the tag-table string data type */
const STRING_DATA_TYPES = ['string'];

/** Check whether dataType is boolean (compatible with both 'boolean' / 'bool') */
export function isBooleanDataType(dataType: string | undefined): boolean {
  return BOOLEAN_DATA_TYPES.includes((dataType ?? '').toLowerCase());
}

/** Check whether dataType is a string type */
export function isStringDataType(dataType: string | undefined): boolean {
  return STRING_DATA_TYPES.includes((dataType ?? '').toLowerCase());
}
