import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActor } from "./useActor";

export function useGetHighScore() {
  const { actor, isFetching } = useActor();
  return useQuery<bigint>({
    queryKey: ["highScore"],
    queryFn: async () => {
      if (!actor) return BigInt(0);
      return actor.getHighScore();
    },
    enabled: !!actor && !isFetching,
  });
}

export function useSetHighScore() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (score: number) => {
      if (!actor) return;
      await actor.setHighScore(BigInt(score));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["highScore"] });
    },
  });
}
