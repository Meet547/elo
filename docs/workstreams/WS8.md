# WS8 — fairness work in progress

This workstream is incomplete and is not deployed. The new proof utilities are not yet activated for live room creation/dealing, and `/verify/[handId]` is not yet implemented. Do not describe the platform as providing a public verifiable shuffle.

## Completed prerequisites

1. Shuffle entropy fails closed without the platform CSPRNG. The new regression failed against the Math.random fallback, then passed after its removal.
2. Live snapshots no longer publish the complete deck seed, even after settlement. A full-shuffle seed reconstructs folded cards, conflicting with the owner's selected privacy policy. A folded-hand regression failed before the serializer change and passes for both seats and spectators. Historical replay passes through that same serializer. The live commitment panel explains its limited proof scope instead of promising public seed replay. Browser-only practice may still replay its local seed: its complete state already belongs to that browser.
3. Shared proof utilities implement context-bound server/client seed commitments, deterministic combination with canonical participant ordering, independent secret salts for deck positions, a domain-separated padded Merkle tree and six-sibling card membership proofs. Malformed metadata, card identity, salts, indices, context and paths fail verification. The internal transcript is explicitly private; public proof values contain no server/client seed.
4. A separately tested exchange state machine freezes participants, rejects reveals until every commitment exists, forbids replacement inputs, revalidates persisted transcripts, and aborts without substitute seeds. It is not yet wired into room commands or browser state.
5. Tests replay 10,000 synthetic internal transcripts and reject tampered seeds/cards/salts/positions/hand IDs/paths. A separate Node crypto calculation checks the Merkle root independently. This verifies utility behavior, not live protocol correctness or a security audit.

## Required next work

- Commit the server seed before collecting client commitments, freeze the participant set, persist commitments before accepting reveals, and handle timeout/abort/reconnect without silent seed substitution.
- Add the browser's private seed persistence and automatic commit/reveal exchange, integrated with ready checks and idempotent room commands.
- Derive each hand's deck from the pinned transcript with a unique hand context. Commit its salted root and persist durable hand evidence atomically with game state.
- Authorize selective position proofs against the actor's own cards, public board and actual showdown disclosure. Never publish folded cards, salts for undisclosed positions or full transcripts through room snapshots, exports or public verification.
- Add the public verification page with explicit membership-only scope and a separate trusted internal replay path. Revealing all combined seeds would defeat folded-card privacy; no public full-deck reconstruction or unbiased-shuffle claim is permitted.
- Test all protocol races, replay/timeout/reload, legacy-room handling, archive persistence and browser flows before marking F9 fixed.
