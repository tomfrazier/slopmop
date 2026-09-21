import type { Row } from "../db/types.js";
import { num, type RepoDeps } from "./shared.js";
import { VOTES, type Community, type Vote } from "./types.js";

/** Votes, one per install per post. Counts are always derived from the votes, so they can't drift. */
export class VoteRepo {
  constructor(private readonly d: RepoDeps) {}

  /** Sets, changes or (with null) clears this install's vote on a post. */
  async set(network: string, contentId: string, installId: string, vote: Vote | null): Promise<Community> {
    const h = this.d.hash(installId);
    if (vote === null) await this.d.db.execute(`DELETE FROM votes WHERE network = ? AND content_id = ? AND install_hash = ?`, [network, contentId, h]);
    else
      await this.d.db.execute(
        `INSERT INTO votes (network, content_id, install_hash, vote, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(network, content_id, install_hash) DO UPDATE SET vote = excluded.vote, at = excluded.at`,
        [network, contentId, h, vote, this.d.now()],
      );
    return this.community(network, contentId);
  }

  async mine(network: string, contentId: string, installId: string): Promise<Vote | null> {
    const r = await this.d.db.execute(`SELECT vote FROM votes WHERE network = ? AND content_id = ? AND install_hash = ?`, [network, contentId, this.d.hash(installId)]);
    return (r.rows[0]?.vote as Vote | undefined) ?? null;
  }

  /** What people have said about this content (votes from disabled installs don't count: see the counted_votes view). */
  async community(network: string, contentId: string): Promise<Community> {
    const r = await this.d.db.execute(`SELECT vote, COUNT(*) AS n FROM counted_votes WHERE network = ? AND content_id = ? GROUP BY vote`, [network, contentId]);
    return toCommunity(r.rows);
  }
}

/** Turns `{vote, n}` rows into a tally. */
export function toCommunity(rows: Row[]): Community {
  const c: Community = { no: 0, maybe: 0, probably: 0, total: 0 };
  for (const r of rows) {
    const v = r.vote as Vote;
    if (VOTES.includes(v)) c[v] = num(r.n);
  }
  c.total = c.no + c.maybe + c.probably;
  return c;
}

/** The plurality vote once at least `minVotes` people have voted; a tie for first place is "maybe". */
export function consensus(c: Community, minVotes: number): Vote | null {
  if (c.total < minVotes) return null;
  const top = Math.max(c.no, c.maybe, c.probably);
  const leaders = VOTES.filter((v) => c[v] === top);
  return leaders.length === 1 ? leaders[0] : "maybe";
}
