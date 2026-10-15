import { describe, expect, it } from "@effect/vitest"
import {
  FINGERPRINT_SIZE,
  fingerprintDistance,
  groupSamePictures,
  SAME_PICTURE_DISTANCE,
} from "../src/analysis/cover-identity.ts"

const LENGTH = FINGERPRINT_SIZE * FINGERPRINT_SIZE * 3

/** A fingerprint whose every byte is `value` (a flat colour). */
const flat = (value: number) => new Uint8Array(LENGTH).fill(value)

/** `base` with `count` bytes raised by `by` — e.g. a re-encode, or a title printed on the art. */
const nudged = (base: Uint8Array, count: number, by: number) => {
  const out = Uint8Array.from(base)
  for (let i = 0; i < count; i++) out[i] = Math.min(255, out[i]! + by)
  return out
}

describe("cover identity", () => {
  it("measures the mean absolute byte difference", () => {
    expect(fingerprintDistance(flat(10), flat(10))).toBe(0)
    expect(fingerprintDistance(flat(10), flat(13))).toBe(3)
    expect(fingerprintDistance(flat(0), nudged(flat(0), LENGTH / 2, 8))).toBe(4)
    expect(fingerprintDistance(flat(0), new Uint8Array(3))).toBe(Number.POSITIVE_INFINITY)
  })

  it("groups byte-identical and near-identical covers, keyed by the alphabetically first cover", () => {
    const art = flat(100)
    const groups = groupSamePictures(
      new Map([
        ["covers/zz-upload-b.jpg", nudged(art, LENGTH, 1)], // re-encode: distance 1
        ["covers/mm-upload-a.jpg", art],
        ["covers/aa-same-bytes.jpg", art],
        ["covers/other.jpg", flat(160)],
      ]),
    )
    expect(groups.get("covers/zz-upload-b.jpg")).toBe("covers/aa-same-bytes.jpg")
    expect(groups.get("covers/mm-upload-a.jpg")).toBe("covers/aa-same-bytes.jpg")
    expect(groups.get("covers/aa-same-bytes.jpg")).toBe("covers/aa-same-bytes.jpg")
    expect(groups.get("covers/other.jpg")).toBe("covers/other.jpg")
  })

  it("keeps covers apart once they differ by more than SAME_PICTURE_DISTANCE", () => {
    const art = flat(50)
    const atLimit = flat(50 + SAME_PICTURE_DISTANCE)
    const beyond = nudged(atLimit, 1, 1)
    expect(groupSamePictures(new Map([["a", art], ["b", atLimit]])).get("b")).toBe("a")
    expect(groupSamePictures(new Map([["a", art], ["b", beyond]])).get("b")).toBe("b")
  })

  it("joins a series of singles transitively (each printed title moves the art a little)", () => {
    const art = flat(80)
    const singles = new Map([
      ["s1", art],
      ["s2", flat(83)],
      ["s3", flat(86)], // 6 from s1, but 3 from s2
    ])
    const groups = groupSamePictures(singles)
    expect(new Set(groups.values())).toEqual(new Set(["s1"]))
  })

  it("does not depend on the input order", () => {
    const entries: Array<[string, Uint8Array]> = [
      ["d", flat(20)],
      ["b", flat(22)],
      ["c", flat(200)],
      ["a", flat(23)],
    ]
    const forward = groupSamePictures(new Map(entries))
    const backward = groupSamePictures(new Map([...entries].reverse()))
    expect(forward).toEqual(backward)
    expect(forward.get("d")).toBe("a")
    expect(forward.get("c")).toBe("c")
  })
})
