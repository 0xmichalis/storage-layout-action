"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ava_1 = __importDefault(require("ava"));
const fs_1 = require("fs");
const rimraf_1 = __importDefault(require("rimraf"));
const util_1 = __importDefault(require("util"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const impl_store_1 = require("./impl-store");
const version_1 = require("./version");
const stub_provider_1 = require("./stub-provider");
const rimraf = util_1.default.promisify(rimraf_1.default);
ava_1.default.before(async () => {
    process.chdir(await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'upgrades-core-test-')));
});
ava_1.default.after(async () => {
    await rimraf(process.cwd());
});
const version1 = (0, version_1.getVersion)('01');
const version2 = (0, version_1.getVersion)('02', '02');
(0, ava_1.default)('deploys on cache miss', async (t) => {
    const provider = (0, stub_provider_1.stubProvider)();
    await (0, impl_store_1.fetchOrDeploy)(version1, provider, provider.deploy);
    t.is(provider.deployCount, 1);
});
(0, ava_1.default)('reuses on cache hit', async (t) => {
    const provider = (0, stub_provider_1.stubProvider)();
    const cachedDeploy = () => (0, impl_store_1.fetchOrDeploy)(version1, provider, provider.deploy);
    const address1 = await cachedDeploy();
    const address2 = await cachedDeploy();
    t.is(provider.deployCount, 1);
    t.is(address2, address1);
});
(0, ava_1.default)('does not reuse unrelated version', async (t) => {
    const provider = (0, stub_provider_1.stubProvider)();
    const address1 = await (0, impl_store_1.fetchOrDeploy)(version1, provider, provider.deploy);
    const address2 = await (0, impl_store_1.fetchOrDeploy)(version2, provider, provider.deploy);
    t.is(provider.deployCount, 2);
    t.not(address2, address1);
});
(0, ava_1.default)('cleans up invalid deployment', async (t) => {
    const chainId = 1234;
    const provider1 = (0, stub_provider_1.stubProvider)(chainId);
    // create a deployment on a network
    await (0, impl_store_1.fetchOrDeploy)(version1, provider1, provider1.deploy);
    // try to fetch it on a different network with same chainId
    const provider2 = (0, stub_provider_1.stubProvider)(chainId);
    await t.throwsAsync((0, impl_store_1.fetchOrDeploy)(version1, provider2, provider2.deploy));
    // the failed deployment has been cleaned up
    await (0, impl_store_1.fetchOrDeploy)(version1, provider2, provider2.deploy);
});
(0, ava_1.default)('merge addresses', async (t) => {
    const depl1 = { address: '0x1' };
    const depl2 = { address: '0x2' };
    const { address, allAddresses } = await (0, impl_store_1.mergeAddresses)(depl1, depl2);
    t.is(address, '0x1');
    t.true(unorderedEqual(allAddresses, ['0x1', '0x2']), allAddresses.toString());
});
(0, ava_1.default)('merge multiple existing addresses', async (t) => {
    const depl1 = { address: '0x1', allAddresses: ['0x1a', '0x1b'] };
    const depl2 = { address: '0x2' };
    const { address, allAddresses } = await (0, impl_store_1.mergeAddresses)(depl1, depl2);
    t.is(address, '0x1');
    t.true(unorderedEqual(allAddresses, ['0x1', '0x1a', '0x1b', '0x2']), allAddresses.toString());
});
(0, ava_1.default)('merge all addresses', async (t) => {
    const depl1 = { address: '0x1', allAddresses: ['0x1a', '0x1b'] };
    const depl2 = { address: '0x2', allAddresses: ['0x2a', '0x2b'] };
    const { address, allAddresses } = await (0, impl_store_1.mergeAddresses)(depl1, depl2);
    t.is(address, '0x1');
    t.true(unorderedEqual(allAddresses, ['0x1', '0x1a', '0x1b', '0x2', '0x2a', '0x2b']), allAddresses.toString());
});
function unorderedEqual(arr1, arr2) {
    return arr1.every(i => arr2.includes(i)) && arr2.every(i => arr1.includes(i));
}
//# sourceMappingURL=impl-store.test.js.map