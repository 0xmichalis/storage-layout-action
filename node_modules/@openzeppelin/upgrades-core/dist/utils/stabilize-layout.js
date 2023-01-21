"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stabilizeStorageLayout = void 0;
const layout_1 = require("../storage/layout");
const type_id_1 = require("./type-id");
function stabilizeStorageLayout(layout) {
    return {
        storage: layout.storage.map(s => ({ ...s, type: (0, type_id_1.stabilizeTypeIdentifier)(s.type) })),
        types: Object.entries(layout.types).map(([type, item]) => {
            const members = item.members &&
                ((0, layout_1.isEnumMembers)(item.members)
                    ? item.members
                    : item.members.map(m => ({ ...m, type: (0, type_id_1.stabilizeTypeIdentifier)(m.type) })));
            return [(0, type_id_1.stabilizeTypeIdentifier)(type), { ...item, members }];
        }),
    };
}
exports.stabilizeStorageLayout = stabilizeStorageLayout;
//# sourceMappingURL=stabilize-layout.js.map