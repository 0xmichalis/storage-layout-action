// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Registry {
    address public owner;
    address[] public modules;
    mapping(address => bool) public isModule;
}
