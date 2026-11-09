# Fairness verification

The versioned protocol, public proof scope, trusted replay and archive behavior are documented in [FAIRNESS.md](../FAIRNESS.md). New rooms commit and combine private client and server seeds before dealing. The public verifier checks membership for disclosed cards under the committed Merkle root. It cannot establish unbiased shuffling or reveal folded cards. The internal audit checks the seed transcript and actual deal order.
