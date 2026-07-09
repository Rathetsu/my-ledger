export type Mutability = { ok: true } | { ok: false; reason: string }

// Spec §3 Mutability: source-linked transactions mutate only through their
// owning flow; transfer legs mutate as a group; plain rows are free.
export function directMutability(t: {
  sourceType: string | null
  transferGroupId: string | null
}): Mutability {
  if (t.sourceType) {
    return {
      ok: false,
      reason:
        'This entry was posted by a confirm flow. Manage it from its source; un-confirm arrives with income sources.',
    }
  }
  if (t.transferGroupId) {
    return {
      ok: false,
      reason:
        'Transfer legs change as a group. Edit or delete the transfer instead.',
    }
  }
  return { ok: true }
}
