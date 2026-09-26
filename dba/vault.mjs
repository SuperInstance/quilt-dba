// dba/vault.mjs — the entropy vault (fleet moth idiom, dba edition).
// Pattern copied from quilt-murmur/murmur/moth.mjs (same doctrine), with the
// live Moth Quantum API path REMOVED: this session runs with NO external API
// calls, so the vault reads REAL CACHED PACKETS from disk and is labeled
// live:false everywhere. A mock never pretends to be quantum.
//
// Doctrine (moth.mjs, preserved):
//   - every consumer can see `live` / `mock` labels on the vault object and
//     in every receipt — the vault never pretends to be live entropy.
//   - harvest once, then stretch deterministically (fnv1a64 counter-mode).
//   - streamFor() derives independent per-purpose sub-streams from the SAME
//     pool (per-seed re-seeding without extra harvests).
//   - STREAM FIX (receipted by murmur E17): FNV-1a's low 32 bits barely
//     avalanche over a 1-char counter change — the fix cross-keys twice per
//     draw: an inner per-index key re-seeds the pool digest, the outer draw
//     re-hashes WITH the pool.
//
// Packets (REAL cached files on disk, read read-only):
//   - /home/z/my-project/download/quilt-cortex/.cache/moth-holdem.json
//     151 cached graph-v1 harvest packets {floats[32], mock, job_id}
//   - /home/z/my-project/download/.cache/moth-e16.json
//     8 cached resonance packets {zz{...moments}, agreement, dominant,
//     job_id, mock:false} — live-harvested at e16 time, cached since.

import { fnv1a64 } from './receipts.mjs';
import { readFileSync } from 'node:fs';

export const HELDEM_CACHE = '/home/z/my-project/download/quilt-cortex/.cache/moth-holdem.json';
export const E16_CACHE = '/home/z/my-project/download/.cache/moth-e16.json';

export class DbaVault {
  constructor({ label = 'dba', heldemPath = HELDEM_CACHE, e16Path = E16_CACHE } = {}) {
    this.label = label;
    this.live = false;              // NO external API this session — hard label
    this.mock = true;               // deterministic disk-cache entropy, labeled
    this.why = 'offline: no MOTH_KEY this session; reading REAL cached packets from disk (no API calls)';
    this.journal = [];
    this.packets = [];

    // -- load real cached packets ------------------------------------------
    const heldemRaw = JSON.parse(readFileSync(heldemPath, 'utf8'));
    const e16Raw = JSON.parse(readFileSync(e16Path, 'utf8'));
    const heldemKeys = Object.keys(heldemRaw).sort();
    const e16Keys = Object.keys(e16Raw).sort();
    const heldemDigest = fnv1a64(heldemKeys.map(k => [k, heldemRaw[k].floats.length, heldemRaw[k].mock, heldemRaw[k].job_id]));
    const e16Digest = fnv1a64(e16Keys.map(k => [k, e16Raw[k].dominant, e16Raw[k].agreement, e16Raw[k].mock, e16Raw[k].job_id]));
    this.packets.push({ name: 'moth-holdem', sourcePath: heldemPath, nPackets: heldemKeys.length, mock: true, liveHarvestOrigin: 'mock:true inside cache', digest: heldemDigest });
    this.packets.push({ name: 'moth-e16', sourcePath: e16Path, nPackets: e16Keys.length, mock: false, liveHarvestOrigin: 'mock:false inside cache (live job ids e16 era)', digest: e16Digest });

    // -- harvest: stretch the cached packets into a bit pool ---------------
    // holdem: 32 floats per packet x first 16 packets -> 32 bits per float
    // (float * 2^32 floor, deterministic IEEE754 -> integer mapping).
    // e16: per packet, 64 bits from fnv1a64 of its stable field tuple.
    const bits = [];
    for (let p = 0; p < Math.min(16, heldemKeys.length); p++) {
      const floats = heldemRaw[heldemKeys[p]].floats;
      for (let i = 0; i < floats.length; i++) {
        const u = Math.floor(floats[i] * 4294967296) >>> 0;
        for (let b = 0; b < 32; b++) bits.push((u >>> b) & 1);
      }
    }
    for (const k of e16Keys) {
      const pk = e16Raw[k];
      const h = BigInt(fnv1a64([k, pk.zz, pk.agreement, pk.dominant, pk.job_id]));
      for (let b = 0; b < 64; b++) bits.push(Number((h >> BigInt(b)) & 1n));
    }
    this.bits = bits;
    this.poolDigest = fnv1a64([heldemDigest, e16Digest, bits.join('')]);
    // sanity (moth doctrine: validate the stream before use): monobit ratio
    let ones = 0;
    for (let i = 0; i < Math.min(4096, bits.length); i++) ones += bits[i];
    this.monobit = ones / Math.min(4096, bits.length);
    if (!(this.monobit > 0.4 && this.monobit < 0.6)) {
      throw new Error(`vault pool failed monobit sanity: ${this.monobit}`);
    }
    this.book('harvest.cache', { bits: bits.length, digest: this.poolDigest, live: this.live, monobit: this.monobit });
  }

  book(kind, extra = {}) {
    const row = { kind, live: this.live, mock: this.mock, ...extra };
    this.journal.push(row);
    return row;
  }

  streamFor(key) {
    const seed = fnv1a64([this.poolDigest, String(key)]);
    let i = 0;
    return () => {
      const inner = fnv1a64(`reseed:${seed}:${i++}`);
      const h = fnv1a64(`stream:${seed}:${inner}`);
      return Number(BigInt(h) & 0xffffffffn) / 4294967296;
    };
  }

  stream(key) { return this.streamFor(key); }

  // u32 draw for seeding the world rng (checkpointable: the DERIVED seed is
  // stored in every bundle so replay never re-reads the vault mid-run).
  u32(key) {
    const seed = fnv1a64([this.poolDigest, String(key)]);
    return Number(BigInt(seed) & 0xffffffffn) >>> 0;
  }

  meta() {
    return {
      live: this.live, mock: this.mock, label: `vault:${this.label}`, why: this.why,
      poolDigest: this.poolDigest, monobit: this.monobit, bits: this.bits.length,
      packets: this.packets, journalRows: this.journal.length,
    };
  }
}
