// Missing revisions remain compatible with older clients during a rollout.
// Updated clients always send a revision and never overwrite a newer draft.
export function setRevisionMatches(expected, current) {
  return expected === undefined || (Number.isSafeInteger(expected) && expected >= 0 && expected === current)
}
