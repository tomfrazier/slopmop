/**
 * A cap on how many Jev calls one server instance has in flight. Past it, callers wait their turn (first come, first
 * served) instead of all reaching the upstream at once; a caller that waits longer than `maxWaitMs` gives up with
 * QueueTimeout so the request fails fast and the client asks again, rather than holding a function open.
 * This is per instance: it smooths a burst, it is not a global quota.
 */
export class QueueTimeout extends Error {
  constructor(readonly waitedMs: number) {
    super(`waited ${waitedMs}ms for a free Jev slot`);
    this.name = "QueueTimeout";
  }
}

export class Gate {
  private active = 0;
  private readonly waiting: { start: () => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(
    private readonly max: number,
    private readonly maxWaitMs: number,
  ) {}

  /** Runs `task` once a slot is free. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.enter();
    try {
      return await task();
    } finally {
      this.leave();
    }
  }

  private enter(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    const began = Date.now();
    return new Promise((resolve, reject) => {
      const entry = {
        start: () => {
          clearTimeout(entry.timer);
          resolve();
        },
        timer: setTimeout(() => {
          this.waiting.splice(this.waiting.indexOf(entry), 1);
          reject(new QueueTimeout(Date.now() - began));
        }, this.maxWaitMs),
      };
      this.waiting.push(entry);
    });
  }

  private leave() {
    const next = this.waiting.shift();
    if (next) next.start(); // the slot passes straight to the next caller
    else this.active--;
  }
}
