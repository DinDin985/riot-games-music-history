/**
 * Which album covers are the same picture. Pure functions — build-db does the
 * I/O (decoding each cover to a fingerprint with sharp).
 *
 * Byte equality is not enough: one picture reaches the archive as several
 * files — the same art re-encoded from two YouTube uploads (Milio, Ahri,
 * K'Sante…), or an album's singles that only change the track title printed on
 * the art (Pentakill's Lost Chapter). The fingerprint is the cover shrunk to
 * 16×16 RGB, small enough to blur printed titles away. On the archive's covers
 * the same picture measures ≤ 2.8 (mean absolute difference, 0–255) and the
 * closest different pictures — the "Music of League of Legends Season N"
 * series, one template with different art — measure ≥ 6.1.
 */

/** Side of the square RGB thumbnail a fingerprint is made of. */
export const FINGERPRINT_SIZE = 16

/** Fingerprints at most this far apart are the same picture. */
export const SAME_PICTURE_DISTANCE = 4

/** Mean absolute difference of two fingerprints (raw RGB bytes of equal length), 0–255. */
export const fingerprintDistance = (a: Uint8Array, b: Uint8Array): number => {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!)
  return sum / a.length
}

/** `fingerprintDistance(a, b) <= maxDistance`, stopping as soon as the answer is no. */
const within = (a: Uint8Array, b: Uint8Array, maxDistance: number): boolean => {
  if (a.length !== b.length || a.length === 0) return false
  const budget = maxDistance * a.length
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i]! - b[i]!)
    if (sum > budget) return false
  }
  return true
}

/**
 * Group covers that show the same picture: covers within `maxDistance` of each
 * other join one group (transitively). Returns every cover's group key — the
 * alphabetically first cover of its group, so keys do not depend on input order.
 */
export const groupSamePictures = (
  fingerprints: ReadonlyMap<string, Uint8Array>,
  maxDistance: number = SAME_PICTURE_DISTANCE,
): Map<string, string> => {
  const covers = [...fingerprints.keys()].sort()
  const parent = covers.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const join = (i: number, j: number) => {
    const [a, b] = [root(i), root(j)]
    // The smaller index (alphabetically first cover) stays the root.
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
  }
  // Byte-identical files decode to identical fingerprints: compare each distinct fingerprint once.
  const firstWith = new Map<string, number>()
  const distinct: Array<number> = []
  covers.forEach((cover, i) => {
    const bytes = Buffer.from(fingerprints.get(cover)!).toString("base64")
    const first = firstWith.get(bytes)
    if (first === undefined) {
      firstWith.set(bytes, i)
      distinct.push(i)
    } else join(first, i)
  })
  for (let x = 0; x < distinct.length; x++) {
    const a = fingerprints.get(covers[distinct[x]!]!)!
    for (let y = x + 1; y < distinct.length; y++) {
      if (within(a, fingerprints.get(covers[distinct[y]!]!)!, maxDistance)) join(distinct[x]!, distinct[y]!)
    }
  }
  return new Map(covers.map((cover, i) => [cover, covers[root(i)]!]))
}

