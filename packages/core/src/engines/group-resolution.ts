import type { Evidence } from '../types/canonical';
import type { TenantProfile } from '../tenant/profile';
import { nameSimilarity, normalizeName } from './party-resolution';

/**
 * Group Resolution Engine — Module 2, and reused unchanged by Module 8.
 *
 * The technical part is easy: draw edges between counterparties that share a
 * director, a shareholder or a registered address, then take the connected
 * components. What makes it usable is everything around that.
 *
 * The spec is blunt about the failure mode. A shared address is usually an
 * accountant's office or a serviced building. A shared director is often a
 * nominee who appears on hundreds of companies. Follow those edges naively and
 * the engine reports one conglomerate containing half the portfolio, users see
 * it, and they stop believing the system inside a week — at which point the
 * module is worthless no matter how correct the rest of it is.
 *
 * So this engine does three things beyond the graph walk:
 *   - it ignores hub persons and hub addresses automatically, above a threshold,
 *     rather than waiting for someone to curate an exclusion list first;
 *   - it reports those hubs back as suggested exclusions, so the list gets
 *     built from what the data actually contains;
 *   - it scores confidence as the weakest link in the group, not the strongest,
 *     because a group is only as trustworthy as the flimsiest edge holding it
 *     together.
 *
 * Nothing here is ever applied automatically. The system proposes, a person
 * confirms, and the result is never used to block an order.
 */

export type GroupSignal = 'shareholder' | 'director' | 'registered_address' | 'name_similarity';

export interface GroupResolutionParty {
  partyId: string;
  legalName: string;
  taxId: string | null;
  registeredAddress: string | null;
}

/** A natural person appearing on a company's register. */
export interface PersonLink {
  /** Stable key for the person — a hashed id where available, else the name. */
  personKey: string;
  personName: string;
  partyId: string;
  role: 'director' | 'shareholder';
  sharePct: number | null;
}

/** A company holding shares in another company that is also a counterparty. */
export interface CompanyShareholding {
  holderPartyId: string;
  ownedPartyId: string;
  sharePct: number | null;
}

export interface SignalHit {
  kind: GroupSignal;
  weight: number;
  /** Human-readable reason, shown verbatim in the evidence panel. */
  detail: string;
}

export interface GroupEdge {
  leftPartyId: string;
  rightPartyId: string;
  signals: SignalHit[];
  confidence: number;
}

export interface ProposedGroup {
  /** Stable within a run, derived from the sorted member ids. */
  key: string;
  suggestedName: string;
  memberPartyIds: string[];
  /** The weakest edge holding the group together. */
  confidence: number;
  edges: GroupEdge[];
  evidence: Evidence[];
}

export interface ExclusionSuggestion {
  kind: 'person' | 'address';
  value: string;
  partyCount: number;
  /** True when this hub was already ignored in this run. */
  applied: boolean;
}

export interface GroupResolutionResult {
  groups: ProposedGroup[];
  edges: GroupEdge[];
  suggestedExclusions: ExclusionSuggestion[];
  stats: {
    partiesConsidered: number;
    edgesFound: number;
    edgesBelowThreshold: number;
    hubPersonsIgnored: number;
    hubAddressesIgnored: number;
  };
}

export interface GroupResolutionOptions {
  /** A person on more than this many counterparties is treated as a nominee. */
  nomineePersonThreshold?: number;
  /** An address shared by more than this many counterparties is a building. */
  sharedAddressThreshold?: number;
  /** Name-similarity score at which two names are worth proposing. */
  nameSimilarityThreshold?: number;
  observedAt?: string;
}

const DEFAULT_WEIGHTS: Record<GroupSignal, number> = {
  shareholder: 0.5,
  director: 0.3,
  registered_address: 0.15,
  name_similarity: 0.05,
};

const PERSON_TITLES = ['นาย', 'นาง', 'นางสาว', 'น.ส.', 'ดร.', 'mr', 'mrs', 'ms', 'miss', 'dr'];

/** Strips honorifics so the same person spelled two ways still matches. */
export function normalizePersonName(raw: string): string {
  let s = raw.toLowerCase().replace(/[.,()]/g, ' ');
  for (const title of PERSON_TITLES) {
    if (s.startsWith(`${title} `) || s.startsWith(title)) s = s.slice(title.length);
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Addresses are compared on a deliberately crude normalisation. Anything
 * cleverer starts guessing at Thai administrative structure, and a wrong guess
 * here silently merges two unrelated companies.
 */
export function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,\-()/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Combines independent signals: 1 - Π(1 - w). Two weak signals beat one. */
function combineConfidence(signals: SignalHit[]): number {
  const product = signals.reduce((acc, s) => acc * (1 - Math.min(0.99, Math.max(0, s.weight))), 1);
  return Math.round((1 - product) * 1000) / 1000;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function resolveGroups(
  parties: GroupResolutionParty[],
  personLinks: PersonLink[],
  shareholdings: CompanyShareholding[],
  profile: TenantProfile,
  options: GroupResolutionOptions = {},
): GroupResolutionResult {
  const {
    nomineePersonThreshold = 10,
    sharedAddressThreshold = 5,
    nameSimilarityThreshold = 0.9,
    observedAt = new Date().toISOString(),
  } = options;

  const policy = profile.groupResolution;
  const enabled = new Set<GroupSignal>(policy.signalsEnabled as GroupSignal[]);
  const weightOf = (signal: GroupSignal): number =>
    policy.signalWeights[signal] ?? DEFAULT_WEIGHTS[signal];

  const partyById = new Map(parties.map((p) => [p.partyId, p]));
  const excludedPersons = new Set(policy.excludedPersons.map(normalizePersonName));
  const excludedAddresses = new Set(policy.excludedAddresses.map(normalizeAddress));

  const edgeMap = new Map<string, SignalHit[]>();
  const addSignal = (a: string, b: string, hit: SignalHit) => {
    if (a === b) return;
    const key = pairKey(a, b);
    const list = edgeMap.get(key);
    if (list) list.push(hit);
    else edgeMap.set(key, [hit]);
  };

  const suggestedExclusions: ExclusionSuggestion[] = [];
  let hubPersonsIgnored = 0;
  let hubAddressesIgnored = 0;

  /* ---- people on more than one register ------------------------------- */
  const byPerson = new Map<string, { name: string; links: PersonLink[] }>();
  for (const link of personLinks) {
    const key = normalizePersonName(link.personKey || link.personName);
    if (key === '') continue;
    const bucket = byPerson.get(key);
    if (bucket) bucket.links.push(link);
    else byPerson.set(key, { name: link.personName, links: [link] });
  }

  for (const [key, { name, links }] of byPerson) {
    const partyIds = [...new Set(links.map((l) => l.partyId))];
    if (partyIds.length < 2) continue;

    // The exclusion list is written by people, so it holds names — but the
    // bucket key is a stable id. Check both, or an excluded nominee keeps
    // fusing companies while the setting appears to be applied.
    if (excludedPersons.has(key) || excludedPersons.has(normalizePersonName(name))) continue;

    // The nominee guard. A person on this many boards is a service, not an
    // owner, and following their edges would fuse the whole portfolio.
    if (partyIds.length > nomineePersonThreshold) {
      hubPersonsIgnored += 1;
      suggestedExclusions.push({ kind: 'person', value: name, partyCount: partyIds.length, applied: true });
      continue;
    }

    for (let i = 0; i < partyIds.length; i += 1) {
      for (let j = i + 1; j < partyIds.length; j += 1) {
        const a = partyIds[i]!;
        const b = partyIds[j]!;
        const rolesA = links.filter((l) => l.partyId === a).map((l) => l.role);
        const rolesB = links.filter((l) => l.partyId === b).map((l) => l.role);

        if (enabled.has('shareholder') && rolesA.includes('shareholder') && rolesB.includes('shareholder')) {
          const pctA = links.find((l) => l.partyId === a && l.role === 'shareholder')?.sharePct;
          const pctB = links.find((l) => l.partyId === b && l.role === 'shareholder')?.sharePct;
          addSignal(a, b, {
            kind: 'shareholder',
            weight: weightOf('shareholder'),
            detail: `${name} holds shares in both${pctA != null && pctB != null ? ` (${pctA}% / ${pctB}%)` : ''}`,
          });
        }
        if (enabled.has('director') && rolesA.includes('director') && rolesB.includes('director')) {
          addSignal(a, b, {
            kind: 'director',
            weight: weightOf('director'),
            detail: `${name} is a director of both`,
          });
        }
      }
    }
  }

  /* ---- company shareholdings ------------------------------------------ */
  if (enabled.has('shareholder')) {
    for (const holding of shareholdings) {
      if (!partyById.has(holding.holderPartyId) || !partyById.has(holding.ownedPartyId)) continue;
      const holder = partyById.get(holding.holderPartyId)!;
      addSignal(holding.holderPartyId, holding.ownedPartyId, {
        kind: 'shareholder',
        weight: weightOf('shareholder'),
        detail: `${holder.legalName} holds ${holding.sharePct != null ? `${holding.sharePct}% of ` : 'shares in '}the other`,
      });
    }
  }

  /* ---- registered address --------------------------------------------- */
  if (enabled.has('registered_address')) {
    const byAddress = new Map<string, string[]>();
    for (const party of parties) {
      if (!party.registeredAddress) continue;
      const key = normalizeAddress(party.registeredAddress);
      if (key === '' || excludedAddresses.has(key)) continue;
      const bucket = byAddress.get(key);
      if (bucket) bucket.push(party.partyId);
      else byAddress.set(key, [party.partyId]);
    }

    for (const [key, partyIds] of byAddress) {
      if (partyIds.length < 2) continue;
      // Same guard as nominees: a building is not a corporate group.
      if (partyIds.length > sharedAddressThreshold) {
        hubAddressesIgnored += 1;
        suggestedExclusions.push({ kind: 'address', value: key, partyCount: partyIds.length, applied: true });
        continue;
      }
      for (let i = 0; i < partyIds.length; i += 1) {
        for (let j = i + 1; j < partyIds.length; j += 1) {
          addSignal(partyIds[i]!, partyIds[j]!, {
            kind: 'registered_address',
            weight: weightOf('registered_address'),
            detail: `same registered address: ${key}`,
          });
        }
      }
    }
  }

  /* ---- name similarity ------------------------------------------------- */
  // Weakest signal by design, and blocked on the first token so this stays
  // linear-ish on a real portfolio instead of comparing every pair.
  if (enabled.has('name_similarity')) {
    const blocks = new Map<string, GroupResolutionParty[]>();
    for (const party of parties) {
      const token = normalizeName(party.legalName).split(' ')[0] ?? '';
      if (token.length < 2) continue;
      const bucket = blocks.get(token);
      if (bucket) bucket.push(party);
      else blocks.set(token, [party]);
    }
    for (const bucket of blocks.values()) {
      if (bucket.length < 2 || bucket.length > 200) continue;
      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          const a = bucket[i]!;
          const b = bucket[j]!;
          const score = nameSimilarity(a.legalName, b.legalName);
          if (score < nameSimilarityThreshold) continue;
          addSignal(a.partyId, b.partyId, {
            kind: 'name_similarity',
            weight: weightOf('name_similarity') * score,
            detail: `names are ${(score * 100).toFixed(0)}% alike`,
          });
        }
      }
    }
  }

  /* ---- edges, then components ------------------------------------------ */
  const edges: GroupEdge[] = [];
  let edgesBelowThreshold = 0;

  for (const [key, signals] of edgeMap) {
    const [leftPartyId, rightPartyId] = key.split('|') as [string, string];
    const confidence = combineConfidence(signals);
    if (confidence < policy.confidenceThreshold) {
      edgesBelowThreshold += 1;
      continue;
    }
    edges.push({ leftPartyId, rightPartyId, signals, confidence });
  }

  const uf = new UnionFind();
  for (const edge of edges) uf.union(edge.leftPartyId, edge.rightPartyId);

  const members = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const id of [edge.leftPartyId, edge.rightPartyId]) {
      const root = uf.find(id);
      const bucket = members.get(root);
      if (bucket) bucket.add(id);
      else members.set(root, new Set([id]));
    }
  }

  const edgesByRoot = new Map<string, GroupEdge[]>();
  for (const edge of edges) {
    const root = uf.find(edge.leftPartyId);
    const bucket = edgesByRoot.get(root);
    if (bucket) bucket.push(edge);
    else edgesByRoot.set(root, [edge]);
  }

  const groups: ProposedGroup[] = [];
  for (const [root, memberSet] of members) {
    const memberPartyIds = [...memberSet].sort();
    const groupEdges = edgesByRoot.get(root) ?? [];
    // Weakest link: a chain of three companies joined by one flimsy edge is
    // exactly as trustworthy as that edge.
    const confidence = groupEdges.reduce((min, e) => Math.min(min, e.confidence), 1);

    const evidence: Evidence[] = groupEdges.flatMap((edge) =>
      edge.signals.map((signal) => ({
        code: `group_${signal.kind}`,
        sourceRef: `party:${edge.leftPartyId}|party:${edge.rightPartyId}`,
        observedAt,
        detail: { detail: signal.detail, weight: signal.weight, confidence: edge.confidence },
      })),
    );

    // Name the group after its most connected member. Sorting by name length —
    // which this did until it reached a real portfolio — names a three-company
    // group after whichever member happens to have the shortest name, and that
    // was the member joined by the weakest edge. A reviewer reading the list
    // should see the company the group actually revolves around.
    const centrality = new Map<string, { edges: number; weight: number }>();
    for (const edge of groupEdges) {
      for (const id of [edge.leftPartyId, edge.rightPartyId]) {
        const current = centrality.get(id) ?? { edges: 0, weight: 0 };
        centrality.set(id, { edges: current.edges + 1, weight: current.weight + edge.confidence });
      }
    }
    // When every member is connected to every other, centrality cannot pick a
    // hub. Fall back to the member whose name it shares with the most others:
    // corporate groups usually carry a family name, and naming the group after
    // the one member that shares nothing is the worst available answer.
    const sharedNameScore = (id: string): number => {
      const own = new Set(
        normalizeName(partyById.get(id)?.legalName ?? '')
          .split(' ')
          .filter((token) => token.length > 2),
      );
      if (own.size === 0) return 0;
      return memberPartyIds.filter((other) => {
        if (other === id) return false;
        return normalizeName(partyById.get(other)?.legalName ?? '')
          .split(' ')
          .some((token) => token.length > 2 && own.has(token));
      }).length;
    };

    const hub = [...memberPartyIds].sort((a, b) => {
      const ca = centrality.get(a) ?? { edges: 0, weight: 0 };
      const cb = centrality.get(b) ?? { edges: 0, weight: 0 };
      if (cb.edges !== ca.edges) return cb.edges - ca.edges;
      if (cb.weight !== ca.weight) return cb.weight - ca.weight;
      const sa = sharedNameScore(a);
      const sb = sharedNameScore(b);
      if (sb !== sa) return sb - sa;
      return (partyById.get(a)?.legalName ?? a).length - (partyById.get(b)?.legalName ?? b).length;
    })[0]!;

    groups.push({
      key: memberPartyIds.join('|'),
      suggestedName: partyById.get(hub)?.legalName ?? hub,
      memberPartyIds,
      confidence,
      edges: groupEdges,
      evidence,
    });
  }

  groups.sort((a, b) => b.memberPartyIds.length - a.memberPartyIds.length || b.confidence - a.confidence);
  suggestedExclusions.sort((a, b) => b.partyCount - a.partyCount);

  return {
    groups,
    edges,
    suggestedExclusions,
    stats: {
      partiesConsidered: parties.length,
      edgesFound: edges.length,
      edgesBelowThreshold,
      hubPersonsIgnored,
      hubAddressesIgnored,
    },
  };
}
