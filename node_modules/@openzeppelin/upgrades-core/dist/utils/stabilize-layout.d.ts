import { StorageLayout } from '../storage';
export declare function stabilizeStorageLayout(layout: StorageLayout): {
    storage: {
        type: string;
        astId?: number | undefined;
        contract: string;
        label: string;
        src: string;
        offset?: number | undefined;
        slot?: string | undefined;
        retypedFrom?: string | undefined;
        renamedFrom?: string | undefined;
    }[];
    types: (string | {
        members: string[] | {
            type: string;
            label: string;
            retypedFrom?: string | undefined;
            renamedFrom?: string | undefined;
            offset?: number | undefined;
            slot?: string | undefined;
        }[] | undefined;
        label: string;
        numberOfBytes?: string | undefined;
        underlying?: string | undefined;
    })[][];
};
//# sourceMappingURL=stabilize-layout.d.ts.map