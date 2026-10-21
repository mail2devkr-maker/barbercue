import { allowedOfferTransitions, allowedPersonActions, deriveLifecycle, isOpenOffer, latestOffer } from "../lifecycle";

const episode = (episodeNumber, status) => ({ id: `e${episodeNumber}`, episodeNumber, status, joinedOn: null, exitedOn: null });
const offer = (version, status, extra = {}) => ({ id: `o${version}`, version, status, supersededByVersion: null, ...extra });

describe("deriveLifecycle", () => {
  test("an offer without an employment episode is simply offered", () => {
    expect(deriveLifecycle({ currentEpisode: null })).toBe("OFFERED");
  });

  test.each([
    [episode(1, "PENDING_JOIN"), "OFFERED"],
    [episode(2, "PENDING_JOIN"), "REOFFERED"],
    [episode(1, "NOT_JOINED"), "NOT_JOINED"],
    [episode(1, "ACTIVE"), "ACTIVE"],
    [episode(2, "ACTIVE"), "REJOINED"],
    [episode(1, "EXITED"), "EXITED"],
    [episode(2, "EXITED"), "EXITED"],
  ])("episode %j is %s", (currentEpisode, expected) => {
    expect(deriveLifecycle({ currentEpisode })).toBe(expected);
  });
});

describe("offer transitions (offer axis only)", () => {
  test("an issued letter can be recorded as emailed, accepted, declined or expired", () => {
    expect(allowedOfferTransitions(offer(1, "ISSUED"))).toEqual(["SENT", "ACCEPTED", "DECLINED", "EXPIRED"]);
  });

  test("an emailed letter cannot be 'emailed' again", () => {
    expect(allowedOfferTransitions(offer(1, "SENT"))).toEqual(["ACCEPTED", "DECLINED", "EXPIRED"]);
  });

  test.each(["ACCEPTED", "DECLINED", "EXPIRED", "DRAFT"])("%s is final for this screen", (status) => {
    expect(allowedOfferTransitions(offer(1, status))).toEqual([]);
  });

  test("a replaced version is read-only history", () => {
    expect(allowedOfferTransitions(offer(1, "ISSUED", { supersededByVersion: 2 }))).toEqual([]);
    expect(isOpenOffer(offer(1, "ISSUED", { supersededByVersion: 2 }))).toBe(false);
  });
});

describe("person actions", () => {
  const person = (currentEpisode, offers) => ({ currentEpisode, offers });

  test("a person with no offers has no actions", () => {
    expect(allowedPersonActions(person(null, []))).toEqual({
      canReoffer: false, canRehire: false, canRecordJoining: false, canRecordNotJoined: false, canRecordExit: false,
    });
  });

  test("joining is only offered for an accepted, current offer", () => {
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "ISSUED")])).canRecordJoining).toBe(false);
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "SENT")])).canRecordJoining).toBe(false);
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "ACCEPTED")])).canRecordJoining).toBe(true);
  });

  test("did-not-join is available while awaiting joining, never for a declined letter", () => {
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "ACCEPTED")])).canRecordNotJoined).toBe(true);
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "EXPIRED")])).canRecordNotJoined).toBe(true);
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "DECLINED")])).canRecordNotJoined).toBe(false);
  });

  test("a new offer cannot be issued while another is still awaiting its outcome", () => {
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "SENT")])).canReoffer).toBe(false);
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "ACCEPTED")])).canReoffer).toBe(false);
  });

  test("after a lapsed or declined offer a re-offer is possible", () => {
    expect(allowedPersonActions(person(episode(1, "PENDING_JOIN"), [offer(1, "DECLINED")])).canReoffer).toBe(true);
    expect(allowedPersonActions(person(episode(1, "NOT_JOINED"), [offer(1, "EXPIRED")])).canReoffer).toBe(true);
  });

  test("a candidate who accepted but never joined can be re-offered with the same ID", () => {
    const actions = allowedPersonActions(person(episode(1, "NOT_JOINED"), [offer(1, "ACCEPTED")]));
    expect(actions.canReoffer).toBe(true);
    expect(actions.canRecordJoining).toBe(false);
  });

  test("an active employee can only be exited — no offer, no second joining", () => {
    expect(allowedPersonActions(person(episode(1, "ACTIVE"), [offer(1, "ACCEPTED")]))).toEqual({
      canReoffer: false, canRehire: false, canRecordJoining: false, canRecordNotJoined: false, canRecordExit: true,
    });
  });

  test("a former employee can be rehired; once the rehire offer exists it must be resolved first", () => {
    expect(allowedPersonActions(person(episode(1, "EXITED"), [offer(1, "ACCEPTED")])).canRehire).toBe(true);
    // The rehire offer opens episode 2, which is awaiting joining: no second offer, no second rehire.
    const rehireOpen = allowedPersonActions(person(episode(2, "PENDING_JOIN"), [offer(1, "ACCEPTED", { supersededByVersion: 2 }), offer(2, "ISSUED")]));
    expect(rehireOpen.canRehire).toBe(false);
    expect(rehireOpen.canReoffer).toBe(false);
  });
});

describe("latestOffer", () => {
  test("is the highest version regardless of order", () => {
    expect(latestOffer([offer(2, "ISSUED"), offer(1, "DECLINED"), offer(3, "SENT")]).version).toBe(3);
    expect(latestOffer([])).toBeNull();
  });
});
