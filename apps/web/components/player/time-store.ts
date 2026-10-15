/**
 * Tiny external store for the playback position.
 *
 * The provider writes the audio element's `currentTime` here every animation
 * frame while playing (and on seek/timeupdate otherwise). Components subscribe
 * through `useCurrentTime(fps)`, whose snapshot is quantised to `fps` steps per
 * second, so React only re-renders the subscribers that need it, at the rate
 * they asked for — the rest of the tree never re-renders on time changes.
 */
export class TimeStore {
  private time = 0
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly get = (): number => this.time

  set(time: number): void {
    if (!Number.isFinite(time) || time === this.time) return
    this.time = time
    for (const l of this.listeners) l()
  }
}
