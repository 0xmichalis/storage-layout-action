// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct Position {
    uint128 amount0;
    uint128 amount1;
    address owner;
}

contract Vault {
    address public manager;
    bool public paused;
    uint256 public totalShares;
    mapping(address => Position) public positions;
    uint256[46] private __gap;
}
