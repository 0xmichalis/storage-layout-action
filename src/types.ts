import {SolcInput, SolcOutput} from '@openzeppelin/upgrades-core'

/**
 * A BuildInfo is a file that contains all the information of a solc run. It
 * includes all the necessary information to recreate that exact same run, and
 * all of its output.
 */
export interface BuildInfo {
  _format: string
  id: string
  solcVersion: string
  solcLongVersion: string
  input: SolcInput
  output: SolcOutput
}
