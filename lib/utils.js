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
exports.getBuildInfo = void 0;
const path = __importStar(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
function getBuildInfo(artifactsPath, fullyQualifiedName) {
    return __awaiter(this, void 0, void 0, function* () {
        const artifactPath = formArtifactPathFromFullyQualifiedName(artifactsPath, fullyQualifiedName);
        const debugFilePath = _getDebugFilePath(artifactPath);
        const buildInfoPath = yield _getBuildInfoFromDebugFile(debugFilePath);
        if (buildInfoPath === undefined) {
            throw Error(`Cannot find build info path: debug filepath: ${debugFilePath}`);
        }
        return fs_extra_1.default.readJSON(buildInfoPath);
    });
}
exports.getBuildInfo = getBuildInfo;
/**
 * Returns the absolute path to the given artifact
 */
function formArtifactPathFromFullyQualifiedName(artifactsPath, fullyQualifiedName) {
    const { sourceName, contractName } = parseFullyQualifiedName(fullyQualifiedName);
    return path.join(artifactsPath, sourceName, contractName);
}
/**
 * Parses a fully qualified name.
 *
 * @param fullyQualifiedName It MUST be a fully qualified name.
 */
function parseFullyQualifiedName(fullyQualifiedName) {
    const { sourceName, contractName } = parseName(fullyQualifiedName);
    if (sourceName === undefined) {
        throw new Error(`Cannot parse fully qualified name ${fullyQualifiedName}`);
    }
    return { sourceName, contractName };
}
/**
 * Parses a name, which can be a bare contract name, or a fully qualified name.
 */
function parseName(name) {
    const parts = name.split(':');
    if (parts.length === 1) {
        return { contractName: parts[0] };
    }
    const contractName = parts[parts.length - 1];
    const sourceName = parts.slice(0, parts.length - 1).join(':');
    return { sourceName, contractName };
}
function _getDebugFilePath(artifactPath) {
    return artifactPath.replace(/\.json$/, '.dbg.json');
}
/**
 * Given the path to a debug file, returns the absolute path to its
 * corresponding build info file if it exists, or undefined otherwise.
 */
function _getBuildInfoFromDebugFile(debugFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        if (yield fs_extra_1.default.pathExists(debugFilePath)) {
            const { buildInfo } = yield fs_extra_1.default.readJson(debugFilePath);
            return path.resolve(path.dirname(debugFilePath), buildInfo);
        }
        return undefined;
    });
}
