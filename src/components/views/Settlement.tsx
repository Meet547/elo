"use client";

import { useFelt } from "@/store/game";
import { Receipt } from "@/components/felt/receipt";
import { TactileButton } from "@/components/felt/kit";

export function Settlement() {
  const { settleResult: r, playAgain, backToLobby, openProfile, profile } = useFelt();
  if (!r) return null;

  return <Receipt
    mode="practice"
    reference={`TBL-${String(r.tableNo).padStart(4, "0")}`}
    player={profile?.name ?? "You"}
    seat={r.seat}
    seats={r.seats}
    hands={r.hands}
    finalStack={r.finalStack}
    net={r.finalStack - 1500}
    place={r.place}
    biggestPot={r.biggestPot}
    bestHand={r.bestHand}
    fieldAvg={r.fieldAvg}
    ratingBefore={r.ratingBefore}
    ratingAfter={r.ratingAfter}
    rated={r.rankAfter > 0}
    rankBefore={r.rankBefore}
    rankAfter={r.rankAfter}
    settledAt={r.settledAt}
    onHome={backToLobby}
    actions={<>
      <TactileButton size="lg" onClick={playAgain}>Play again — $1,500</TactileButton>
      <TactileButton variant="paper" size="lg" onClick={openProfile}>Your profile</TactileButton>
    </>}
  />;
}
