import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import type { Db } from "./db/types.js";
import { CapRepo } from "./repos/caps.js";
import { ClientRepo } from "./repos/clients.js";
import { ContentRepo } from "./repos/content.js";
import { EventRepo } from "./repos/events.js";
import { ExportRepo } from "./repos/exports.js";
import { CuratedRepo } from "./repos/curated.js";
import { VoteRepo } from "./repos/votes.js";

export { dayKey, nextResetIso } from "./repos/shared.js";
export { consensus } from "./repos/votes.js";
export { deviceId } from "./repos/clients.js";
export { VOTES } from "./repos/types.js";
export type { CheckEvent, Community, ContentWrite, DisabledClient, EventKind, ExportRow, ReusableVerdict, StoredVerdict, Usage, Vote } from "./repos/types.js";

/**
 * The registry, split by responsibility: `caps` (the daily cap), `events` (the activity log), `clients` (kill switch and
 * rate window), `content` (what Jev said about each post), `votes`, and `exports` (for tuning). This class only wires
 * them to the database, the config and the clock, and owns the one thing they all share: hashing install ids.
 */
export class Store {
  readonly caps: CapRepo;
  readonly events: EventRepo;
  readonly clients: ClientRepo;
  readonly content: ContentRepo;
  readonly votes: VoteRepo;
  readonly exports: ExportRepo;
  readonly curated: CuratedRepo;

  constructor(
    readonly db: Db,
    readonly config: Config,
    readonly now: () => number = Date.now,
  ) {
    const deps = { db, config, now, hash: (id: string) => this.hashInstall(id) };
    this.caps = new CapRepo(deps);
    this.events = new EventRepo(deps);
    this.clients = new ClientRepo(deps);
    this.content = new ContentRepo(deps);
    this.votes = new VoteRepo(deps);
    this.exports = new ExportRepo(deps);
    this.curated = new CuratedRepo(deps);
  }

  /** Only a salted hash of an install id is ever stored. */
  hashInstall(installId: string): string {
    return createHash("sha256").update(`${this.config.installSalt}\n${installId}`).digest("hex").slice(0, 32);
  }
}
