import { describe, expect, it } from "vitest";
import { dailyUsage } from "../src/shared/usage";

const NOW = Date.UTC(2026, 9, 6, 18, 0);
const usage = (used: number, resetsInMs: number) => ({ used, limit: 250, resetsAt: new Date(NOW + resetsInMs).toISOString() });

describe("checks used today", () => {
  it("shows the server's count until its reset time, then zero until the server says otherwise", () => {
    expect(dailyUsage({ usage: usage(37, 3600_000) }, NOW, 250)).toMatchObject({ shown: 37, limit: 250, full: false });
    expect(dailyUsage({ usage: usage(37, -1) }, NOW, 250)).toMatchObject({ shown: 0, full: false });
  });

  it("uses the fallback limit before the server has answered", () => {
    expect(dailyUsage({}, NOW, 300)).toMatchObject({ shown: 0, limit: 300, full: false });
  });

  it("shows the whole limit while checking is held, for any reason", () => {
    const later = { until: NOW + 60_000 };
    expect(dailyUsage({ usage: usage(12, 3600_000), dailyLimit: later }, NOW, 250)).toMatchObject({ shown: 250, full: true });
    expect(dailyUsage({ usage: usage(12, 3600_000), blocked: { ...later, message: "off" } }, NOW, 250)).toMatchObject({ shown: 250, full: true, disabled: true });
    expect(dailyUsage({ usage: usage(12, 3600_000), dcIpPause: { ...later, message: "paused" } }, NOW, 250)).toMatchObject({ shown: 250, full: true, dcPaused: true });
    expect(dailyUsage({ usage: usage(12, 3600_000), dailyLimit: { until: NOW - 1 } }, NOW, 250)).toMatchObject({ shown: 12, full: false }); // an expired hold
  });
});
