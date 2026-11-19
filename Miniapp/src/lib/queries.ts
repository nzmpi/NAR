import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
    Asset,
    PayoutAddress,
    Portfolio,
    RelockRow,
    WithdrawalRow,
} from "./types";

export const usePortfolio = () =>
    useQuery({
        queryKey: ["portfolio"],
        queryFn: () => api<Portfolio>("/me/portfolio"),
        refetchInterval: 60_000,
    });
export const useAssets = () =>
    useQuery({ queryKey: ["assets"], queryFn: () => api<Asset[]>("/assets") });
export const useWithdrawals = () =>
    useQuery({
        queryKey: ["withdrawals"],
        queryFn: () => api<WithdrawalRow[]>("/me/withdrawals"),
        refetchInterval: 30_000,
    });
export const useRelocks = () =>
    useQuery({
        queryKey: ["relocks"],
        queryFn: () => api<RelockRow[]>("/me/relocks"),
        refetchInterval: 30_000,
    });
export const usePayoutAddresses = () =>
    useQuery({
        queryKey: ["payout-addresses"],
        queryFn: () => api<PayoutAddress[]>("/me/payout-addresses"),
    });
