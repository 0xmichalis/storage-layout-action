import * as path from 'path'
import fsExtra from 'fs-extra'

import {BuildInfo} from './types'

export async function getBuildInfo(
  artifactsPath: string,
  fullyQualifiedName: string
): Promise<BuildInfo> {
  const artifactPath = formArtifactPathFromFullyQualifiedName(artifactsPath, fullyQualifiedName)

  const debugFilePath = _getDebugFilePath(artifactPath)
  const buildInfoPath = await _getBuildInfoFromDebugFile(debugFilePath)

  if (buildInfoPath === undefined) {
    throw Error(`Cannot find build info path: debug filepath: ${debugFilePath}`)
  }

  return fsExtra.readJSON(buildInfoPath)
}

/**
 * Returns the absolute path to the given artifact
 */
function formArtifactPathFromFullyQualifiedName(
  artifactsPath: string,
  fullyQualifiedName: string
): string {
  const {sourceName, contractName} = parseFullyQualifiedName(fullyQualifiedName)

  return path.join(artifactsPath, sourceName, contractName)
}

/**
 * Parses a fully qualified name.
 *
 * @param fullyQualifiedName It MUST be a fully qualified name.
 */
function parseFullyQualifiedName(fullyQualifiedName: string): {
  sourceName: string
  contractName: string
} {
  const {sourceName, contractName} = parseName(fullyQualifiedName)

  if (sourceName === undefined) {
    throw new Error(`Cannot parse fully qualified name ${fullyQualifiedName}`)
  }

  return {sourceName, contractName}
}

/**
 * Parses a name, which can be a bare contract name, or a fully qualified name.
 */
function parseName(name: string): {
  sourceName?: string
  contractName: string
} {
  const parts = name.split(':')

  if (parts.length === 1) {
    return {contractName: parts[0]}
  }

  const contractName = parts[parts.length - 1]
  const sourceName = parts.slice(0, parts.length - 1).join(':')

  return {sourceName, contractName}
}

function _getDebugFilePath(artifactPath: string): string {
  return artifactPath.replace(/\.json$/, '.dbg.json')
}

/**
 * Given the path to a debug file, returns the absolute path to its
 * corresponding build info file if it exists, or undefined otherwise.
 */
async function _getBuildInfoFromDebugFile(debugFilePath: string): Promise<string | undefined> {
  if (await fsExtra.pathExists(debugFilePath)) {
    const {buildInfo} = await fsExtra.readJson(debugFilePath)
    return path.resolve(path.dirname(debugFilePath), buildInfo)
  }

  return undefined
}
