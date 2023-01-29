"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const upgrades_core_1 = require("@openzeppelin/upgrades-core");
const ethers_1 = require("ethers");
const fs_extra_1 = __importDefault(require("fs-extra"));
const utils_1 = require("./utils");
function getImplementationForProxyOrBeacon(provider, proxyOrBeaconAddress) {
    return __awaiter(this, void 0, void 0, function* () {
        // Check if it's a UUPS or Transparent proxy
        try {
            const implAddress = yield (0, upgrades_core_1.getImplementationAddress)(provider, proxyOrBeaconAddress);
            return implAddress;
        }
        catch (_a) { }
        // Check if it's a beacon proxy
        try {
            const implAddress = yield (0, upgrades_core_1.getBeaconAddress)(provider, proxyOrBeaconAddress);
            return implAddress;
        }
        catch (_b) { }
        // Check if it's a beacon
        try {
            const implAddress = yield (0, upgrades_core_1.getImplementationAddressFromBeacon)(provider, proxyOrBeaconAddress);
            return implAddress;
        }
        catch (_c) { }
        throw Error(`Provided address does not look like a proxy or beacon: ${proxyOrBeaconAddress}`);
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const contractNames = core.getInput('fullyQualifiedContractNames').split(',');
            const addresses = core.getInput('proxyOrBeaconAddresses').split(',');
            if (contractNames.length !== addresses.length)
                throw Error(`Length mismatch between fullyQualifiedContractNames (${contractNames.length}) and proxyOrBeaconAddresses (${addresses.length})`);
            const storageLayoutPath = core.getInput('storageLayoutPath');
            const manifestDir = '.openzeppelin';
            if (storageLayoutPath !== manifestDir && storageLayoutPath !== `${manifestDir}/`) {
                console.log(`Copying ${storageLayoutPath}/ to ${manifestDir}/ ...`);
                yield fs_extra_1.default.copy(`${storageLayoutPath}/`, `${manifestDir}/`);
            }
            const rpcURL = core.getInput('nodeRpcUrl');
            const provider = new ethers_1.providers.StaticJsonRpcProvider(rpcURL);
            const manifest = yield upgrades_core_1.Manifest.forNetwork(provider);
            console.log(`Manifest: ${JSON.stringify(manifest)}`);
            const artifactsPath = core.getInput('buildArtifactsPath');
            for (let i = 0; i < contractNames.length; i++) {
                // Determine layout for deployed contract by looking at network manifest
                console.log(`Proxy: ${addresses[i]} (${contractNames[i]})`);
                const implAddress = yield getImplementationForProxyOrBeacon(provider, addresses[i]);
                console.log(`Implementation: ${implAddress}`);
                const d = yield manifest.getDeploymentFromAddress(implAddress);
                console.log(`Deployment: ${JSON.stringify(d)}`);
                // Generate storage upgrade report
                const solcInfo = yield (0, utils_1.getBuildInfo)(artifactsPath, contractNames[i]);
                console.log(`Build info: ${solcInfo}`);
                const updated = new upgrades_core_1.UpgradeableContract(contractNames[i], solcInfo.input, solcInfo.output);
                console.log(`UpgradeableContract: ${updated.version}`);
                const report = (0, upgrades_core_1.getStorageUpgradeReport)(d.layout, updated.layout, (0, upgrades_core_1.withValidationDefaults)({
                    unsafeAllowRenames: true
                }));
                // Check report results
                if (!report.pass) {
                    throw new upgrades_core_1.StorageUpgradeErrors(report);
                }
            }
        }
        catch (error) {
            if (error instanceof Error)
                core.setFailed(error.message);
        }
    });
}
run();
