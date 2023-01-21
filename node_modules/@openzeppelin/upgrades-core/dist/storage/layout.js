"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasLayout = exports.isStructMembers = exports.isEnumMembers = exports.getDetailedLayout = void 0;
const parse_type_id_1 = require("../utils/parse-type-id");
function getDetailedLayout(layout) {
    const cache = {};
    return layout.storage.map(parseItemWithDetails);
    function parseItemWithDetails(item) {
        return { ...item, type: parseIdWithDetails(item.type) };
    }
    function parseIdWithDetails(typeId) {
        const parsed = (0, parse_type_id_1.parseTypeId)(typeId);
        return addDetailsToParsedType(parsed);
    }
    function addDetailsToParsedType(parsed) {
        if (parsed.id in cache) {
            return cache[parsed.id];
        }
        const item = layout.types[parsed.id];
        const detailed = {
            ...parsed,
            args: undefined,
            rets: undefined,
            item: {
                ...item,
                members: undefined,
                underlying: undefined,
            },
        };
        // store in cache before recursion below
        cache[parsed.id] = detailed;
        detailed.args = parsed.args?.map(addDetailsToParsedType);
        detailed.rets = parsed.rets?.map(addDetailsToParsedType);
        detailed.item.members =
            item?.members && (isStructMembers(item?.members) ? item.members.map(parseItemWithDetails) : item?.members);
        detailed.item.underlying = item?.underlying === undefined ? undefined : parseIdWithDetails(item.underlying);
        return detailed;
    }
}
exports.getDetailedLayout = getDetailedLayout;
function isEnumMembers(members) {
    return members.length === 0 || typeof members[0] === 'string';
}
exports.isEnumMembers = isEnumMembers;
function isStructMembers(members) {
    return members.length === 0 || typeof members[0] === 'object';
}
exports.isStructMembers = isStructMembers;
function hasLayout(field) {
    return field.offset !== undefined && field.slot !== undefined && field.type.item.numberOfBytes !== undefined;
}
exports.hasLayout = hasLayout;
//# sourceMappingURL=layout.js.map