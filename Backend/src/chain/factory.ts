import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { getClient } from "./client.js";

export const FACTORY_ABI = parseAbi([
    "function deploy(bytes32 salt) returns (address vault)",
    "function deployAndTransfer(bytes32 salt, address to, address[] tokens, uint256[] amounts) returns (address)",
    "function transfer(address vault, address to, address[] tokens, uint256[] amounts)",
    "function transferNative(address vault, address to)",
    "function getVault(bytes32 salt) view returns (address)",
]);
const ERC20_ABI = parseAbi([
    "function balanceOf(address) view returns (uint256)",
]);

export const encodeDeploy = (salt: Hex): Hex =>
    encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: "deploy",
        args: [salt],
    });

export const encodeDeployAndTransfer = (
    salt: Hex,
    to: Address,
    tokens: Address[],
    amounts: bigint[],
): Hex =>
    encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: "deployAndTransfer",
        args: [salt, to, tokens, amounts],
    });

export const encodeTransfer = (
    vault: Address,
    to: Address,
    tokens: Address[],
    amounts: bigint[],
): Hex =>
    encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: "transfer",
        args: [vault, to, tokens, amounts],
    });

export const encodeTransferNative = (vault: Address, to: Address): Hex =>
    encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: "transferNative",
        args: [vault, to],
    });

export async function codeAt(
    chainId: number,
    address: string,
): Promise<boolean> {
    const code = await getClient(chainId).getCode({
        address: address as Address,
    });
    return !!code && code !== "0x";
}

// Factory.getVault(salt): the vault the Factory recorded for this salt (zero address if none).
export async function onchainVault(
    chainId: number,
    factory: Address,
    salt: Hex,
): Promise<string> {
    const a = await getClient(chainId).readContract({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "getVault",
        args: [salt],
    });
    return (a as string).toLowerCase();
}

export async function tokenBalance(
    chainId: number,
    token: string,
    owner: string,
): Promise<bigint> {
    return getClient(chainId).readContract({
        address: token as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [owner as Address],
    }) as Promise<bigint>;
}

export const nativeBalance = (
    chainId: number,
    owner: string,
): Promise<bigint> =>
    getClient(chainId).getBalance({ address: owner as Address });
