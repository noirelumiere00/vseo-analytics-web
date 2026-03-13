import { trpc } from "@/lib/trpc";

export function useQuota() {
  const query = trpc.subscription.status.useQuery(undefined, { staleTime: 30_000 });
  return {
    plan: query.data?.plan ?? "free",
    used: query.data?.used ?? 0,
    limit: query.data?.limit ?? 3,
    isExceeded: query.data?.isExceeded ?? false,
    isLoading: query.isLoading,
  };
}
