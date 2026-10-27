import { getMatchInput } from "./api";
import { useQuery } from "./hooks";
import { computeMatches } from "./match";

/** Personalised match candidates for the signed-in user. Recomputes whenever listings, profiles or exchanges change. */
export function useMatches() {
  return useQuery(() => {
    const input = getMatchInput();
    return {
      candidates: computeMatches(input),
      members: input.members,
      others: input.others,
      myOffers: input.myOffers,
      myNeeds: input.myNeeds,
      hasListings: input.myOffers.length + input.myNeeds.length > 0,
      communitySize: input.others.size,
    };
  });
}
