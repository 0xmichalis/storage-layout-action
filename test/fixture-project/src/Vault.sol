// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

enum Status {
    Active,
    Halted
}

struct Position {
    uint128 amount0;
    uint128 amount1;
    address owner;
    Status status;
}

contract Vault {
    address public manager;
    bool public paused;
    uint256 public totalShares;
    mapping(address => Position) public positions;
    Status public status;
    uint256[46] private __gap;
}
