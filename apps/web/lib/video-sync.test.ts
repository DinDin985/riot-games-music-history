import { describe, expect, it } from "vitest"
import type { Alignment } from "@workspace/db/domain/alignment"
import {
  DRIFT,
  driftDecision,
  handBackPoint,
  lockTarget,
  matchLayout,
  resolveSync,
  songClockAt,
  songCutSpans,
  spanAt,
  startPoint,
  stepVideoBySong,
  syncBadge,
  updateSeekLead,
  videoOnlySpans,
} from "./video-sync.ts"

/**
 * "Legends Never Die" (Worlds 2017): the music video plays the song as
 * released for 2:32, then CUTS ~55 s (the second verse + pre-chorus, song
 * 2:32 → 3:27) and ends with ~4 s of video-only outro. Same fixture as
 * packages/db/test/repo.test.ts.
 */
const LND: Alignment = {
  songId: "legends-never-die",
  videoId: "r6zIGXun57U",
  songDuration: 235.1,
  videoDuration: 179,
  segments: [
    {
      songStart: 0,
      songEnd: 152.14,
      videoStart: 0.106,
      videoEnd: 152.24,
      offset: 0.106,
      score: 7.5,
    },
    {
      songStart: 206.94,
      songEnd: 229.78,
      videoStart: 152.19,
      videoEnd: 175.03,
      offset: -54.751,
      score: 4.8,
    },
  ],
  coverage: 0.74,
  confidence: 0.83,
  method: "chroma+waveform",
}

/** Two segments separated by a 0.3 s hole in the song (aligner imprecision, not a real cut). */
const MICRO_GAP: Alignment = {
  songId: "s",
  videoId: "v",
  songDuration: 200,
  videoDuration: 210,
  segments: [
    {
      songStart: 0,
      songEnd: 100,
      videoStart: 2,
      videoEnd: 102,
      offset: 2,
      score: 6,
    },
    {
      songStart: 100.3,
      songEnd: 200,
      videoStart: 102.7,
      videoEnd: 202.4,
      offset: 2.4,
      score: 6,
    },
  ],
  coverage: 1,
  confidence: 0.9,
  method: "audio:chroma",
}

const input = (alignment: Alignment | null, extra: Partial<Parameters<typeof resolveSync>[0]> = {}) =>
  resolveSync({
    songId: "legends-never-die",
    videoId: "r6zIGXun57U",
    alignment,
    sharesAudio: false,
    songDuration: 235.1,
    videoDuration: 179,
    ...extra,
  })

describe("resolveSync", () => {
  it("uses the stored audio alignment", () => {
    const sync = input(LND)
    expect(sync.quality).toBe("matched")
    expect(sync.alignment.segments).toHaveLength(2)
  })

  it("prefers the <video> element's real duration and sorts segments", () => {
    const sync = input({ ...LND, segments: [...LND.segments].reverse() }, { videoDuration: 179.4 })
    expect(sync.alignment.videoDuration).toBe(179.4)
    expect(sync.alignment.segments[0]!.songStart).toBe(0)
  })

  it("treats an identity alignment from the pipeline as perfect sync", () => {
    expect(input({ ...LND, method: "identity" }).quality).toBe("identity")
  })

  it("maps one-to-one when the track was taken from the video itself", () => {
    const sync = input(null, {
      sharesAudio: true,
      songDuration: 213,
      videoDuration: 213.2,
    })
    expect(sync.quality).toBe("identity")
    expect(startPoint(sync.alignment, { songTime: 120 })).toMatchObject({
      kind: "exact",
      videoTime: 120,
    })
    expect(handBackPoint(sync.alignment, 212.9)).toEqual({
      songTime: 212.9,
      atEnd: true,
    })
  })

  it("falls back to an approximate identity mapping without an alignment", () => {
    const sync = input(null)
    expect(sync.quality).toBe("approximate")
    expect(sync.alignment.segments).toEqual([
      {
        songStart: 0,
        songEnd: 179,
        videoStart: 0,
        videoEnd: 179,
        offset: 0,
        score: 0,
      },
    ])
    expect(startPoint(sync.alignment, { songTime: 42 })).toMatchObject({
      kind: "exact",
      videoTime: 42,
    })
    // The song is longer than the video: its last minute has no video → start the video from the top.
    expect(startPoint(sync.alignment, { songTime: 200 })).toMatchObject({
      kind: "restart",
      videoTime: 0,
    })
  })

  it("ignores alignments for another video or without any match", () => {
    expect(input({ ...LND, videoId: "someOtherId" }).quality).toBe("approximate")
    expect(input({ ...LND, segments: [] }).quality).toBe("approximate")
  })

  it("still produces a usable mapping when no duration is known", () => {
    const sync = input(null, { songDuration: null, videoDuration: null })
    expect(startPoint(sync.alignment, { songTime: 30 })).toMatchObject({
      kind: "exact",
      videoTime: 30,
    })
  })
})

describe("startPoint (hand-off)", () => {
  it("opens at the same musical moment inside a matched segment", () => {
    expect(startPoint(LND, { songTime: 60 })).toEqual({
      kind: "exact",
      videoTime: 60.106,
      songTime: 60,
      requestedSongTime: null,
    })
  })

  it("snaps a moment the video cut to where the video resumes the song", () => {
    expect(startPoint(LND, { songTime: 180 })).toEqual({
      kind: "snapped",
      videoTime: 152.19,
      songTime: 206.94,
      requestedSongTime: 180,
    })
    // Just past the end of the first segment is already inside the 55 s cut.
    expect(startPoint(LND, { songTime: 152.5 }).kind).toBe("snapped")
  })

  it("does not announce sub-second snaps between segments", () => {
    expect(startPoint(MICRO_GAP, { songTime: 100.1 })).toEqual({
      kind: "exact",
      videoTime: 102.7,
      songTime: 100.3,
      requestedSongTime: null,
    })
  })

  it("never maps before the video's first frame (segment clipped at video 0 with a negative offset)", () => {
    // Real pipeline output (arcade-2019-ultracombo): the song starts 0.255 s before the video does.
    const clipped: Alignment = {
      ...MICRO_GAP,
      songDuration: 182.3,
      videoDuration: 182.1,
      segments: [{ songStart: 0, songEnd: 182.23, videoStart: 0, videoEnd: 181.975, offset: -0.255, score: 10.7 }],
    }
    expect(startPoint(clipped, { songTime: 0 })).toMatchObject({ kind: "exact", videoTime: 0 })
    expect(startPoint(clipped, { songTime: 0.1 }).videoTime).toBe(0)
    expect(lockTarget(clipped, 0)).toEqual({ kind: "play", videoTime: 0, segmentIndex: 0 })
    expect(startPoint(clipped, { songTime: 10 }).videoTime).toBeCloseTo(9.745, 3)
  })

  it("restarts the video when the song is past everything the video contains", () => {
    expect(startPoint(LND, { songTime: 232 })).toEqual({
      kind: "restart",
      videoTime: 0,
      songTime: 0,
      requestedSongTime: 232,
    })
  })

  it("honours an explicit video time (curated key moment) and maps it back to the song", () => {
    const p = startPoint(LND, { videoTime: 160 })
    expect(p.kind).toBe("video")
    expect(p.videoTime).toBe(160)
    expect(p.songTime).toBeCloseTo(214.751, 3)
    expect(startPoint(LND, { videoTime: 999 }).videoTime).toBe(179)
  })
})

describe("songClockAt (player position while the video plays)", () => {
  it("maps video time back to song time across the cut", () => {
    const c = songClockAt(LND, 160)
    expect(c.videoOnly).toBe(false)
    expect(c.segmentIndex).toBe(1)
    expect(c.songTime).toBeCloseTo(214.751, 3)
  })

  it("uses the first segment where the two overlap by a few ms", () => {
    const c = songClockAt(LND, 152.2)
    expect(c.segmentIndex).toBe(0)
    expect(c.songTime).toBeCloseTo(152.094, 3)
  })

  it("holds the song where it left off during video-only material", () => {
    expect(songClockAt(LND, 177)).toEqual({
      songTime: 229.78,
      videoOnly: true,
      segmentIndex: null,
      resumeSongTime: 229.78,
    })
    expect(songClockAt(LND, 0.05)).toEqual({
      songTime: 0,
      videoOnly: true,
      segmentIndex: null,
      resumeSongTime: 0,
    })
  })
})

describe("handBackPoint (closing the popup)", () => {
  it("continues the song at the musical moment the video is at", () => {
    const hb = handBackPoint(LND, 160)
    expect(hb.songTime).toBeCloseTo(214.751, 3)
    expect(hb.atEnd).toBe(false)
  })

  it("continues at the resume point when closed during video-only material", () => {
    expect(handBackPoint(LND, 177)).toEqual({ songTime: 229.78, atEnd: false })
    expect(handBackPoint(LND, 0.05)).toEqual({ songTime: 0, atEnd: false })
  })

  it("flags the end of the song", () => {
    const full: Alignment = { ...LND, songDuration: 229.9 }
    expect(handBackPoint(full, 177).atEnd).toBe(true)
  })
})

describe("stepVideoBySong (←/→ = ±5 s of song)", () => {
  it("steps within a segment", () => {
    expect(stepVideoBySong(LND, 60.106, 5)).toBeCloseTo(65.106, 3)
    expect(stepVideoBySong(LND, 60.106, -5)).toBeCloseTo(55.106, 3)
  })

  it("falls back to a video step when the song step lands in a cut right next to the playhead", () => {
    // Video 153 s = song 207.75 s; song 202.75 s was cut, the video resumes the song at 152.19 (only 0.8 s back).
    expect(stepVideoBySong(LND, 153, -5)).toBeCloseTo(148, 3)
    // Video 150 s = song 149.9 s; song 154.9 s was cut → resume point 152.19 is too close: plain step.
    expect(stepVideoBySong(LND, 150, 5)).toBeCloseTo(155, 3)
  })

  it("steps back out of video-only material into the song", () => {
    expect(stepVideoBySong(LND, 177, -5)).toBeCloseTo(170.029, 3)
  })

  it("clamps to the video", () => {
    expect(stepVideoBySong(LND, 174, 5)).toBe(179)
    expect(stepVideoBySong(LND, 2, -5)).toBe(0)
  })
})

describe("lockTarget (video slaved to the song)", () => {
  it("plays the matched moment", () => {
    expect(lockTarget(LND, 60)).toEqual({
      kind: "play",
      videoTime: 60.106,
      segmentIndex: 0,
    })
    const t = lockTarget(LND, 214.751)
    expect(t.kind).toBe("play")
    if (t.kind === "play") {
      expect(t.videoTime).toBeCloseTo(160, 3)
      expect(t.segmentIndex).toBe(1)
    }
  })

  it("reports a gap while the song plays a part cut from the video", () => {
    expect(lockTarget(LND, 180)).toEqual({
      kind: "gap",
      resumeVideoTime: 152.19,
      resumeSongTime: 206.94,
      segmentIndex: 1,
    })
  })

  it("plays through micro-gaps on the next segment's clock", () => {
    const t = lockTarget(MICRO_GAP, 100.1)
    expect(t.kind).toBe("play")
    if (t.kind === "play") expect(t.videoTime).toBeCloseTo(102.5, 3)
  })

  it("treats a song intro missing from the video as a gap", () => {
    const late: Alignment = {
      ...MICRO_GAP,
      segments: [{ ...MICRO_GAP.segments[0]!, songStart: 10, videoStart: 12 }],
    }
    expect(lockTarget(late, 5)).toEqual({
      kind: "gap",
      resumeVideoTime: 12,
      resumeSongTime: 10,
      segmentIndex: 0,
    })
  })

  it("ends after the last matched segment", () => {
    expect(lockTarget(LND, 232)).toEqual({
      kind: "ended",
      lastVideoTime: 175.03,
    })
  })
})

describe("driftDecision", () => {
  const base = {
    target: 10,
    actual: 10,
    playing: true,
    rate: 1,
    segmentChanged: false,
    msSinceSeek: Infinity,
  }

  it("holds when in sync", () => {
    expect(driftDecision({ ...base, actual: 9.99 })).toMatchObject({
      kind: "hold",
      rate: 1,
    })
  })

  it("nudges playbackRate for small drift, in the right direction", () => {
    const behind = driftDecision({ ...base, target: 10.1 })
    expect(behind.kind).toBe("nudge")
    expect(behind.rate).toBeCloseTo(1.06, 5)
    const ahead = driftDecision({ ...base, target: 9.9 })
    expect(ahead.rate).toBeCloseTo(0.94, 5)
    expect(driftDecision({ ...base, target: 10.2 }).rate).toBeCloseTo(1 + DRIFT.nudgeMax, 5)
  })

  it("keeps nudging until the drift is well inside the tolerance (hysteresis)", () => {
    expect(driftDecision({ ...base, target: 10.02, rate: 1.05 })).toMatchObject({ kind: "nudge" })
    expect(driftDecision({ ...base, target: 10.02, rate: 1 })).toMatchObject({
      kind: "hold",
    })
    expect(driftDecision({ ...base, target: 10.01, rate: 1.05 })).toMatchObject({ kind: "hold", rate: 1 })
  })

  it("hard-seeks above 250 ms, ahead by the learnt seek lead", () => {
    const d = driftDecision({ ...base, target: 10.4, lead: 0.1 })
    expect(d.kind).toBe("seek")
    if (d.kind === "seek") expect(d.to).toBeCloseTo(10.5, 5)
  })

  it("does not hard-seek again during the post-seek cooldown", () => {
    expect(driftDecision({ ...base, target: 10.4, msSinceSeek: 100 })).toMatchObject({
      kind: "nudge",
      rate: 1 + DRIFT.nudgeMax,
    })
  })

  it("always seeks at a segment boundary (the video jumps over a cut)", () => {
    expect(driftDecision({ ...base, segmentChanged: true, msSinceSeek: 10 })).toMatchObject({ kind: "seek", to: 10 })
  })

  it("seeks exactly (no lead) while paused, only when the frame is off", () => {
    expect(driftDecision({ ...base, playing: false, target: 10.1, lead: 0.3 })).toMatchObject({
      kind: "seek",
      to: 10.1,
    })
    expect(driftDecision({ ...base, playing: false, target: 10.02 })).toMatchObject({ kind: "hold" })
  })

  it("learns the seek lead from observed lag", () => {
    expect(updateSeekLead(0, 0.2)).toBeCloseTo(0.08, 5)
    expect(updateSeekLead(0.3, 2)).toBe(DRIFT.maxLead)
    expect(updateSeekLead(0.1, -1)).toBe(0)
    expect(updateSeekLead(0.1, Number.NaN)).toBe(0.1)
  })
})

describe("spans and timeline layout", () => {
  it("finds video-only material, ignoring the 0.1 s pre-roll", () => {
    expect(videoOnlySpans(LND)).toEqual([{ start: 175.03, end: 179 }])
    expect(spanAt(videoOnlySpans(LND), 177)).toEqual({
      start: 175.03,
      end: 179,
    })
    expect(spanAt(videoOnlySpans(LND), 0.05)).toBeNull()
  })

  it("finds the parts of the song the video cut", () => {
    expect(songCutSpans(LND)).toEqual([
      { start: 152.14, end: 206.94 },
      { start: 229.78, end: 235.1 },
    ])
  })

  it("lays out song bar ⇄ video bar links as fractions", () => {
    const layout = matchLayout(LND)
    expect(layout.songDuration).toBe(235.1)
    expect(layout.videoDuration).toBe(179)
    expect(layout.links).toHaveLength(2)
    expect(layout.links[1]!.song.start).toBeCloseTo(206.94 / 235.1, 6)
    expect(layout.links[1]!.video.start).toBeCloseTo(152.19 / 179, 6)
    expect(layout.songCuts).toHaveLength(2)
    expect(layout.videoOnly).toHaveLength(1)
  })

  it("labels the confidence chip", () => {
    const badge = syncBadge(input(LND))
    expect(badge).toMatchObject({ label: "Audio match 83%", tone: "good" })
    expect(badge.detail).toContain("74% of the song is in the video")
    expect(badge.detail).toContain("2 matched sections")
    expect(badge.detail).toContain("1 video-only scene")
    expect(syncBadge(input(null)).tone).toBe("approximate")
    expect(syncBadge(input(null, { sharesAudio: true })).label).toBe("Same audio")
  })
})
