import { SolcOutput } from '../solc-api';
import { SrcDecoder } from '../src-decoder';
import { Version } from '../version';
import { LinkReference } from '../link-refs';
import { StorageLayout } from '../storage/layout';
export type ValidationRunData = Record<string, ContractValidation>;
export interface ContractValidation {
    version?: Version;
    src: string;
    inherit: string[];
    libraries: string[];
    methods: string[];
    linkReferences: LinkReference[];
    errors: ValidationError[];
    layout: StorageLayout;
    solcVersion?: string;
}
declare const errorKinds: readonly ["state-variable-assignment", "state-variable-immutable", "external-library-linking", "struct-definition", "enum-definition", "constructor", "delegatecall", "selfdestruct", "missing-public-upgradeto"];
export type ValidationError = ValidationErrorConstructor | ValidationErrorOpcode | ValidationErrorWithName | ValidationErrorUpgradeability;
interface ValidationErrorBase {
    src: string;
    kind: typeof errorKinds[number];
}
interface ValidationErrorWithName extends ValidationErrorBase {
    name: string;
    kind: 'state-variable-assignment' | 'state-variable-immutable' | 'external-library-linking' | 'struct-definition' | 'enum-definition';
}
interface ValidationErrorConstructor extends ValidationErrorBase {
    kind: 'constructor';
    contract: string;
}
interface ValidationErrorOpcode extends ValidationErrorBase {
    kind: 'delegatecall' | 'selfdestruct';
}
export declare function isOpcodeError(error: ValidationErrorBase): error is ValidationErrorOpcode;
interface ValidationErrorUpgradeability extends ValidationErrorBase {
    kind: 'missing-public-upgradeto';
}
/**
 * Get args from the doc string matching the given tag
 */
export declare function getAnnotationArgs(doc: string, tag: string): string[];
export declare function validate(solcOutput: SolcOutput, decodeSrc: SrcDecoder, solcVersion?: string): ValidationRunData;
export {};
//# sourceMappingURL=run.d.ts.map