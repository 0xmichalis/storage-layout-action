import { EthereumProvider } from './provider';
import type { Deployment } from './deployment';
import type { StorageLayout } from './storage';
export interface ManifestData {
    manifestVersion: string;
    impls: {
        [version in string]?: ImplDeployment;
    };
    proxies: ProxyDeployment[];
    admin?: Deployment;
}
export interface ImplDeployment extends Deployment {
    layout: StorageLayout;
    allAddresses?: string[];
}
export interface ProxyDeployment extends Deployment {
    kind: 'uups' | 'transparent' | 'beacon';
}
export declare class Manifest {
    readonly chainId: number;
    readonly file: string;
    private readonly fallbackFile;
    private locked;
    static forNetwork(provider: EthereumProvider): Promise<Manifest>;
    constructor(chainId: number);
    getAdmin(): Promise<Deployment | undefined>;
    getDeploymentFromAddress(address: string): Promise<ImplDeployment>;
    getProxyFromAddress(address: string): Promise<ProxyDeployment>;
    addProxy(proxy: ProxyDeployment): Promise<void>;
    private exists;
    private readFile;
    private writeFile;
    private renameFileIfRequired;
    read(): Promise<ManifestData>;
    write(data: ManifestData): Promise<void>;
    lockedRun<T>(cb: () => Promise<T>): Promise<T>;
    private lock;
}
export declare function migrateManifest(data: ManifestData): ManifestData;
export declare class DeploymentNotFound extends Error {
}
export declare function normalizeManifestData(input: ManifestData): ManifestData;
//# sourceMappingURL=manifest.d.ts.map