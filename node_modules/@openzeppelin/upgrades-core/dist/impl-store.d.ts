import { ImplDeployment } from './manifest';
import { EthereumProvider } from './provider';
import { Deployment } from './deployment';
import { Version } from './version';
import { DeployOpts } from '.';
export interface ManifestField<T> {
    get(): T | undefined;
    set(value: T | undefined): void;
    merge?(value: T | undefined): void;
}
/**
 * Deletes the deployment by setting it to undefined.
 * Should only be used during a manifest run.
 */
export declare function deleteDeployment(deployment: ManifestField<Deployment>): void;
export declare function fetchOrDeploy(version: Version, provider: EthereumProvider, deploy: () => Promise<ImplDeployment>, opts?: DeployOpts, merge?: boolean): Promise<string>;
export declare function fetchOrDeployGetDeployment<T extends ImplDeployment>(version: Version, provider: EthereumProvider, deploy: () => Promise<T>, opts?: DeployOpts, merge?: boolean): Promise<T | Deployment>;
/**
 * Merge the addresses in the deployments and returns them.
 *
 * @param existing existing deployment
 * @param value deployment to add
 */
export declare function mergeAddresses(existing: ImplDeployment, value: ImplDeployment): {
    address: string;
    allAddresses: string[];
};
export declare function fetchOrDeployAdmin(provider: EthereumProvider, deploy: () => Promise<Deployment>, opts?: DeployOpts): Promise<string>;
//# sourceMappingURL=impl-store.d.ts.map