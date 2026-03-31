import { trpc } from "@/lib/trpc";

export function useQuota() {
  const query = trpc.subscription.getQuotaUsage.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const used = query.data?.used ?? 0;
  const limit = query.data?.limit ?? 3;
  const remaining = Math.max(0, limit - used);

  return {
    plan: query.data?.plan ?? "free",
    used,
    limit,
    remaining,
    isExceeded: used >= limit,
    isNearLimit: remaining <= 1,
    isLoading: query.isLoading,
  };
}
