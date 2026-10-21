/**
 * In-memory TEST DOUBLE of the PROPOSED HR register contract (issue #283). Synthetic data only.
 *
 * It exists so the web UI can be exercised end to end before Codex's backend is published. It encodes
 * the business invariants the UI relies on (one permanent code per person, never reused for another
 * person, idempotent saves, no account before an approved joining, append-only history), but it is
 * NOT the contract authority and proves nothing about the real backend. Plain CommonJS so it can run
 * both inside Jest and inside a loopback QA server.
 */

class FakeHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const STANDARD_START = 101;

function mask(value, kind) {
  if (!value) return null;
  if (kind === "email") {
    const [local, domain] = value.split("@");
    return `${local[0]}${"•".repeat(Math.max(2, local.length - 1))}@${domain}`;
  }
  const digits = value.replace(/\D/g, "");
  return `${"•".repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}

const norm = (value) => (value || "").trim().toLowerCase().replace(/\s+/g, " ");
const digitsOf = (value) => (value || "").replace(/\D/g, "").slice(-10);

function similarName(a, b) {
  const x = norm(a).split(" ");
  const y = norm(b).split(" ");
  if (!x[0] || !y[0]) return false;
  return x[0] === y[0] && x[x.length - 1][0] === y[y.length - 1][0];
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createFakeRegister(options = {}) {
  const fail =
    options.fail ||
    ((status, code, message) => {
      throw new FakeHttpError(status, code, message);
    });
  let clock = Date.parse(options.now || "2026-10-22T05:30:00.000Z");
  const tick = () => new Date((clock += 60_000)).toISOString();

  let seq = 0;
  const nextId = (prefix) => `${prefix}-${String(++seq).padStart(4, "0")}`;

  const people = new Map();
  const offers = new Map();
  const episodes = new Map();
  const audit = [];
  const idem = new Map();
  const tokens = new Map();
  const reconciliation = [];
  const actor = { id: "u-hr", displayName: "Synthetic HR Admin" };
  const managers = (options.managers || [
    { id: "m-1", fullName: "Synthetic Manager One", employeeCode: "FQ-FE-00150", status: "ACTIVE" },
    { id: "m-2", fullName: "Synthetic Manager Two", employeeCode: "FQ-FE-00151", status: "ACTIVE" },
  ]).slice();
  const usedCodes = new Set(managers.map((m) => m.employeeCode));
  const calls = [];

  function allocateCode() {
    let n = STANDARD_START;
    while (usedCodes.has(`FQ-FE-${String(n).padStart(5, "0")}`)) n += 1;
    const code = `FQ-FE-${String(n).padStart(5, "0")}`;
    usedCodes.add(code);
    return code;
  }

  function log(personId, action, subjectKind, label, from, to, reason) {
    audit.push({ id: nextId("a"), personId, at: tick(), actor, action, subject: { kind: subjectKind, label }, fromStatus: from || null, toStatus: to || null, reason: reason || null });
  }

  const offersOf = (personId) => [...offers.values()].filter((o) => o.personId === personId).sort((a, b) => a.version - b.version);
  const episodesOf = (personId) => [...episodes.values()].filter((e) => e.personId === personId).sort((a, b) => a.episodeNumber - b.episodeNumber);

  function summary(person) {
    const os = offersOf(person.id);
    const es = episodesOf(person.id);
    const latest = os[os.length - 1];
    const ep = es[es.length - 1] || null;
    return {
      id: person.id,
      employeeCode: person.employeeCode,
      fullName: person.fullName,
      maskedEmail: mask(person.email, "email"),
      maskedPhone: mask(person.phone, "phone"),
      city: person.city || null,
      reportingManager: person.reportingManager || null,
      firstOfferIssuedAt: os[0].issuedAt,
      latestOfferVersion: latest.version,
      latestOfferStatus: latest.status,
      latestOfferIssuedAt: latest.issuedAt,
      offerCount: os.length,
      currentEpisode: ep && { id: ep.id, episodeNumber: ep.episodeNumber, status: ep.status, joinedOn: ep.joinedOn, exitedOn: ep.exitedOn },
      episodeCount: es.length,
      hasEmployeeAccount: Boolean(person.employeeProfileId),
      employeeProfileId: person.employeeProfileId || null,
      origin: person.origin,
    };
  }

  function detail(person) {
    return {
      ...summary(person),
      offers: offersOf(person.id).map((o) => ({ ...o, delivery: { ...o.delivery, pdfCount: o.pdfHistory.length } })),
      episodes: episodesOf(person.id),
      salaryHistory: person.salaryHistory,
      managerHistory: person.managerHistory,
    };
  }

  function lifecycleOf(person) {
    const ep = summary(person).currentEpisode;
    if (!ep) return "OFFERED";
    if (ep.status === "PENDING_JOIN") return ep.episodeNumber > 1 ? "REOFFERED" : "OFFERED";
    if (ep.status === "NOT_JOINED") return "NOT_JOINED";
    if (ep.status === "ACTIVE") return ep.episodeNumber > 1 ? "REJOINED" : "ACTIVE";
    return "EXITED";
  }

  function once(key, body, run) {
    const signature = JSON.stringify(body);
    const seen = idem.get(key);
    if (seen) {
      if (seen.signature !== signature) fail(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with a different request.");
      return clone(seen.result);
    }
    const result = run();
    idem.set(key, { signature, result: clone(result) });
    return clone(result);
  }

  function personOf(personId) {
    const person = people.get(personId);
    if (!person) fail(404, "HR_PERSON_NOT_FOUND", "Person not found.");
    return person;
  }

  function seedPerson(spec) {
    // Test/QA seeding only: creates a person exactly as the register would after the first save.
    const person = {
      id: nextId("p"),
      employeeCode: spec.employeeCode || allocateCode(),
      fullName: spec.fullName,
      email: spec.email || null,
      phone: spec.phone || null,
      address: spec.address || null,
      city: spec.city || null,
      reportingManager: null,
      origin: spec.origin || "OFFER",
      employeeProfileId: null,
      salaryHistory: [],
      managerHistory: [],
    };
    if (spec.employeeCode) usedCodes.add(spec.employeeCode);
    people.set(person.id, person);
    return person;
  }

  function newOffer(person, terms, kind) {
    const prior = offersOf(person.id);
    const version = prior.length + 1;
    for (const o of prior) if (o.supersededByVersion === null) o.supersededByVersion = version;
    const manager = terms.reportingManagerId ? managers.find((m) => m.id === terms.reportingManagerId) : null;
    const offer = {
      id: nextId("o"),
      personId: person.id,
      version,
      kind,
      status: "ISSUED",
      issuedAt: tick(),
      sentAt: null,
      acceptedAt: null,
      declinedAt: null,
      expiredAt: null,
      createdBy: actor,
      source: "REGISTER",
      terms: {
        role: terms.role,
        baseSalaryInr: terms.baseSalaryInr,
        salaryBasis: terms.salaryBasis,
        salesTarget: terms.salesTarget,
        incentiveBeyondTargetInr: terms.incentiveBeyondTargetInr,
        proposedJoiningDate: terms.proposedJoiningDate,
        reportingManager: manager ? { id: manager.id, fullName: manager.fullName, employeeCode: manager.employeeCode } : null,
        city: terms.city,
      },
      delivery: { saved: true, pdfCount: 0, emailedRecordedAt: null, acceptanceProven: false },
      pdfHistory: [],
      supersededByVersion: null,
      employmentEpisodeId: null,
      statusReason: null,
    };
    const eps = episodesOf(person.id);
    let episode = eps[eps.length - 1];
    if (!episode || episode.status === "NOT_JOINED" || episode.status === "EXITED") {
      episode = { id: nextId("e"), personId: person.id, episodeNumber: eps.length + 1, status: "PENDING_JOIN", originatingOfferVersion: version, joinedOn: null, exitedOn: null, notJoinedOn: null, statusReason: null };
      episodes.set(episode.id, episode);
    } else {
      episode.originatingOfferVersion = version;
    }
    offer.employmentEpisodeId = episode.id;
    offers.set(offer.id, offer);
    person.city = terms.city || person.city;
    person.reportingManager = offer.terms.reportingManager;
    log(person.id, "OFFER_ISSUED", "OFFER", `Offer v${version}`, null, "ISSUED");
    return offer;
  }

  const api = {
    calls,
    people,
    offers,
    audit,
    usedCodes,

    seedPerson,
    seedOffer(person, terms, kind = "FIRST") {
      return newOffer(person, terms, kind);
    },

    async probe() {
      calls.push("probe");
    },

    async search(filters, cursor) {
      calls.push("search");
      let rows = [...people.values()];
      const q = norm(filters.q);
      if (q) rows = rows.filter((p) => norm(p.fullName).includes(q) || norm(p.email).includes(q) || digitsOf(p.phone).includes(q.replace(/\D/g, "") || "\u0000"));
      if (filters.employeeCode) rows = rows.filter((p) => p.employeeCode === filters.employeeCode);
      if (filters.lifecycle && filters.lifecycle !== "ALL") rows = rows.filter((p) => lifecycleOf(p) === filters.lifecycle);
      if (filters.offerStatus && filters.offerStatus !== "ALL") rows = rows.filter((p) => summary(p).latestOfferStatus === filters.offerStatus);
      if (filters.city) rows = rows.filter((p) => norm(p.city).includes(norm(filters.city)));
      if (filters.managerId) rows = rows.filter((p) => p.reportingManager && p.reportingManager.id === filters.managerId);
      if (filters.issuedFrom) rows = rows.filter((p) => summary(p).latestOfferIssuedAt.slice(0, 10) >= filters.issuedFrom);
      if (filters.issuedTo) rows = rows.filter((p) => summary(p).latestOfferIssuedAt.slice(0, 10) <= filters.issuedTo);
      rows.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
      const start = cursor ? Number(cursor) : 0;
      const page = rows.slice(start, start + 25);
      return { items: page.map(summary), nextCursor: start + 25 < rows.length ? String(start + 25) : null, total: rows.length };
    },

    async getPerson(personId) {
      calls.push("getPerson");
      return clone(detail(personOf(personId)));
    },

    async matchIdentity(query) {
      calls.push("matchIdentity");
      const found = [];
      for (const person of people.values()) {
        const reasons = [];
        if (query.employeeCode && person.employeeCode === query.employeeCode) reasons.push("EXACT_CODE");
        if (query.email && person.email && norm(query.email) === norm(person.email)) reasons.push("EMAIL");
        if (query.phone && person.phone && digitsOf(query.phone) && digitsOf(query.phone) === digitsOf(person.phone)) reasons.push("PHONE");
        if (query.fullName && norm(query.fullName) === norm(person.fullName)) reasons.push("NAME_EXACT");
        else if (query.fullName && similarName(query.fullName, person.fullName)) reasons.push("NAME_SIMILAR");
        if (reasons.length === 0) continue;
        const contact = reasons.includes("EMAIL") || reasons.includes("PHONE");
        const name = reasons.includes("NAME_EXACT") || reasons.includes("NAME_SIMILAR");
        const strength = reasons.includes("EXACT_CODE") || (contact && name) ? "STRONG" : "WEAK";
        found.push({ person: summary(person), reasons, strength });
      }
      const blocksNewIdentity = found.length > 0 && (found.some((m) => m.strength === "STRONG") || found.length > 1);
      const decisionToken = `tok-${tokens.size + 1}`;
      tokens.set(decisionToken, { ids: found.map((m) => m.person.id), blocksNewIdentity });
      return clone({ matches: found, blocksNewIdentity, decisionToken });
    },

    async createOffer(input, key) {
      calls.push("createOffer");
      return once(key, input, () => {
        const token = tokens.get(input.identity.decisionToken);
        if (!token) fail(409, "HR_MATCH_REVIEW_REQUIRED", "Match review is required before saving an offer.");
        let person;
        let kind = "FIRST";
        if (input.identity.mode === "EXISTING") {
          if (!token.ids.includes(input.identity.personId)) fail(409, "HR_IDENTITY_CONFLICT", "Identity was not part of the reviewed matches.");
          person = personOf(input.identity.personId);
          const eps = episodesOf(person.id);
          const latest = offersOf(person.id).slice(-1)[0];
          if (latest && ["ISSUED", "SENT", "ACCEPTED"].includes(latest.status) && eps[eps.length - 1].status === "PENDING_JOIN") fail(409, "HR_OPEN_OFFER_EXISTS", "Open offer exists.");
          if (eps[eps.length - 1].status === "ACTIVE") fail(409, "HR_OFFER_INVALID_TRANSITION", "Employee is active.");
          kind = eps[eps.length - 1].status === "EXITED" ? "REHIRE" : "REOFFER";
        } else {
          if (token.blocksNewIdentity && !(input.identity.overrideReason && input.identity.overrideReason.trim().length >= 5)) {
            fail(409, "HR_MATCH_REVIEW_REQUIRED", "Close matches exist; a reasoned override is required.");
          }
          const p = input.identity.person;
          person = seedPerson({ fullName: p.fullName, email: p.email, phone: p.phone, address: p.address });
          person.employeeCode = person.employeeCode;
          log(person.id, "IDENTITY_CREATED", "PERSON", person.fullName, null, null, input.identity.overrideReason);
        }
        const offer = newOffer(person, input.terms, kind);
        return {
          person: summary(person),
          offer: { ...offer },
          letter: { candidateName: person.fullName, email: person.email, phone: person.phone, address: person.address },
        };
      });
    },

    async transitionOffer(offerId, to, reason, key) {
      calls.push("transitionOffer");
      return once(key, { offerId, to, reason }, () => {
        const offer = offers.get(offerId);
        if (!offer) fail(404, "HR_OFFER_NOT_FOUND", "Offer not found.");
        const allowed = { ISSUED: ["SENT", "ACCEPTED", "DECLINED", "EXPIRED"], SENT: ["ACCEPTED", "DECLINED", "EXPIRED"] }[offer.status] || [];
        if (offer.supersededByVersion !== null || !allowed.includes(to)) fail(409, "HR_OFFER_INVALID_TRANSITION", "Invalid transition.");
        const from = offer.status;
        offer.status = to;
        const at = tick();
        if (to === "SENT") { offer.sentAt = at; offer.delivery.emailedRecordedAt = at; }
        if (to === "ACCEPTED") { offer.acceptedAt = at; offer.delivery.acceptanceProven = true; }
        if (to === "DECLINED") offer.declinedAt = at;
        if (to === "EXPIRED") offer.expiredAt = at;
        offer.statusReason = reason || offer.statusReason;
        log(offer.personId, `OFFER_${to}`, "OFFER", `Offer v${offer.version}`, from, to, reason);
        return { ...offer };
      });
    },

    async recordJoining(offerId, input, key) {
      calls.push("recordJoining");
      return once(key, { offerId, joinedOn: input.joinedOn, territory: input.territory }, () => {
        const offer = offers.get(offerId);
        if (!offer || offer.status !== "ACCEPTED" || offer.supersededByVersion !== null) fail(409, "HR_OFFER_INVALID_TRANSITION", "Offer must be accepted.");
        const person = personOf(offer.personId);
        const episode = episodes.get(offer.employmentEpisodeId);
        if (episode.status !== "PENDING_JOIN") fail(409, "HR_OFFER_INVALID_TRANSITION", "Not awaiting joining.");
        episode.status = "ACTIVE";
        episode.joinedOn = input.joinedOn;
        // First joining creates the single employee account; a rehire re-enables the SAME one.
        if (!person.employeeProfileId) person.employeeProfileId = nextId("ep");
        person.salaryHistory.push({ id: nextId("s"), effectiveFrom: input.joinedOn, baseSalaryInr: offer.terms.baseSalaryInr, salaryBasis: offer.terms.salaryBasis, offerVersion: offer.version, recordedAt: tick(), recordedBy: actor });
        for (const open of person.managerHistory) if (open.to === null) open.to = input.joinedOn;
        if (offer.terms.reportingManager) person.managerHistory.push({ id: nextId("mh"), manager: offer.terms.reportingManager, from: input.joinedOn, to: null, offerVersion: offer.version, recordedAt: tick(), recordedBy: actor });
        log(person.id, episode.episodeNumber > 1 ? "REJOINED" : "JOINED", "EPISODE", `Episode ${episode.episodeNumber}`, "PENDING_JOIN", "ACTIVE");
        return detail(person);
      });
    },

    async recordNotJoined(offerId, input, key) {
      calls.push("recordNotJoined");
      return once(key, { offerId, ...input }, () => {
        const offer = offers.get(offerId);
        if (!offer) fail(404, "HR_OFFER_NOT_FOUND", "Offer not found.");
        const episode = episodes.get(offer.employmentEpisodeId);
        if (episode.status !== "PENDING_JOIN") fail(409, "HR_OFFER_INVALID_TRANSITION", "Not awaiting joining.");
        episode.status = "NOT_JOINED";
        episode.notJoinedOn = input.decidedOn;
        episode.statusReason = input.reason;
        log(offer.personId, "NOT_JOINED", "EPISODE", `Episode ${episode.episodeNumber}`, "PENDING_JOIN", "NOT_JOINED", input.reason);
        return detail(personOf(offer.personId));
      });
    },

    async recordExit(episodeId, input, key) {
      calls.push("recordExit");
      return once(key, { episodeId, ...input }, () => {
        const episode = episodes.get(episodeId);
        if (!episode || episode.status !== "ACTIVE") fail(409, "HR_OFFER_INVALID_TRANSITION", "Employee is not active.");
        episode.status = "EXITED";
        episode.exitedOn = input.exitedOn;
        episode.statusReason = input.reason;
        log(episode.personId, "EXITED", "EPISODE", `Episode ${episode.episodeNumber}`, "ACTIVE", "EXITED", input.reason);
        return detail(personOf(episode.personId));
      });
    },

    async recordPdfEvent(offerId, input, key) {
      calls.push("recordPdfEvent");
      return once(key, { offerId, ...input }, () => {
        const offer = offers.get(offerId);
        if (!offer) fail(404, "HR_OFFER_NOT_FOUND", "Offer not found.");
        const entry = { id: nextId("pdf"), event: input.event, at: tick(), actor, sha256: input.sha256, byteLength: input.byteLength };
        offer.pdfHistory.push(entry);
        offer.delivery.pdfCount = offer.pdfHistory.length;
        log(offer.personId, `PDF_${input.event}`, "OFFER", `Offer v${offer.version}`);
        return entry;
      });
    },

    async getLetterData(offerId) {
      calls.push("getLetterData");
      const offer = offers.get(offerId);
      if (!offer) fail(404, "HR_OFFER_NOT_FOUND", "Offer not found.");
      const person = personOf(offer.personId);
      log(person.id, "LETTER_DATA_READ", "OFFER", `Offer v${offer.version}`);
      return { candidateName: person.fullName, email: person.email, phone: person.phone, address: person.address };
    },

    async listAudit(personId, cursor) {
      calls.push("listAudit");
      personOf(personId);
      const rows = audit.filter((a) => a.personId === personId).reverse();
      const start = cursor ? Number(cursor) : 0;
      const size = options.auditPageSize || 25;
      return clone({ items: rows.slice(start, start + size).map((row) => { const entry = { ...row }; delete entry.personId; return entry; }), nextCursor: start + size < rows.length ? String(start + size) : null });
    },

    seedReconciliation(items) {
      const start = reconciliation.length;
      for (const item of items) reconciliation.push({ id: nextId("r"), source: "SENT_MAIL_AUDIT", acceptanceEvidence: "NONE", possibleDuplicateOf: null, status: "UNVERIFIED", linkedPerson: null, printedEmployeeCode: null, candidateLabel: null, ...item });
      return reconciliation.slice(start);
    },

    async listReconciliation(status, cursor) {
      calls.push("listReconciliation");
      const rows = reconciliation.filter((r) => status === "ALL" || r.status === status);
      const start = cursor ? Number(cursor) : 0;
      return clone({ items: rows.slice(start, start + 25), nextCursor: start + 25 < rows.length ? String(start + 25) : null });
    },

    async linkReconciliation(itemId, personId, key) {
      calls.push("linkReconciliation");
      return once(key, { itemId, personId }, () => {
        const item = reconciliation.find((r) => r.id === itemId);
        const person = personOf(personId);
        item.status = "LINKED";
        item.linkedPerson = { id: person.id, employeeCode: person.employeeCode, fullName: person.fullName };
        log(person.id, "RECONCILIATION_LINKED", "RECONCILIATION", item.id);
        return { ...item };
      });
    },

    async markReconciliationDuplicate(itemId, duplicateOfItemId, key) {
      calls.push("markReconciliationDuplicate");
      return once(key, { itemId, duplicateOfItemId }, () => {
        const item = reconciliation.find((r) => r.id === itemId);
        item.status = "DUPLICATE";
        item.possibleDuplicateOf = duplicateOfItemId;
        return { ...item };
      });
    },

    async createReconciliationIdentity(itemId, historyChecked, key) {
      calls.push("createReconciliationIdentity");
      return once(key, { itemId, historyChecked }, () => {
        if (historyChecked !== true) fail(422, "VALIDATION_FAILED", "History check required.");
        const item = reconciliation.find((r) => r.id === itemId);
        const person = seedPerson({ fullName: item.candidateLabel || "Unnamed candidate", origin: "RECONCILIATION" });
        const offer = newOffer(person, { role: "Not recorded", baseSalaryInr: 0, salaryBasis: "monthly", salesTarget: null, incentiveBeyondTargetInr: null, proposedJoiningDate: null, reportingManagerId: null, city: null }, "FIRST");
        offer.source = "HISTORICAL_IMPORT";
        offer.status = "SENT";
        item.status = "IDENTITY_CREATED";
        item.linkedPerson = { id: person.id, employeeCode: person.employeeCode, fullName: person.fullName };
        return { ...item };
      });
    },

    async listManagers() {
      calls.push("listManagers");
      return managers.filter((m) => m.status === "ACTIVE").map(({ id, fullName, employeeCode }) => ({ id, fullName, employeeCode }));
    },
  };
  return api;
}

module.exports = { createFakeRegister, FakeHttpError };
