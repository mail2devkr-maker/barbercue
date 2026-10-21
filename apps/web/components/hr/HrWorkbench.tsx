"use client";

import { useCallback, useState } from "react";
import { httpHrRegisterApi, type HrRegisterApi } from "../../lib/hr-register/api";
import type { HrCreateOfferResult, HrPersonSummary } from "../../lib/hr-register/types";
import OfferComposer from "./OfferComposer";
import PersonTimeline from "./PersonTimeline";
import ReconciliationWorklist from "./ReconciliationWorklist";
import RegisterGate from "./RegisterGate";
import RegisterPanel from "./RegisterPanel";

/**
 * Offer Letter & Employee Register: composer, searchable register, per-person timeline and the
 * historical-letter reconciliation worklist, behind one fail-closed gate.
 */
export default function HrWorkbench({ api = httpHrRegisterApi }: { api?: HrRegisterApi }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preset, setPreset] = useState<HrPersonSummary | null>(null);
  // Remounting the composer on every "start offer" gives it a clean form, even if it is still showing a previous "offer saved" card.
  const [composerKey, setComposerKey] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);
  const [timelineVersion, setTimelineVersion] = useState(0);

  const bumpList = useCallback(() => setListRefresh((value) => value + 1), []);

  function startOffer(person: HrPersonSummary) {
    setPreset(person);
    setComposerKey((value) => value + 1);
    window.requestAnimationFrame(() => document.getElementById("offer-letter")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function offerSaved(result: HrCreateOfferResult) {
    bumpList();
    if (selectedId === result.person.id) setTimelineVersion((value) => value + 1);
  }

  function openPerson(personId: string) {
    setSelectedId(personId);
    window.requestAnimationFrame(() => document.getElementById("hr-person-title")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <RegisterGate api={api}>
      <OfferComposer
        key={composerKey}
        api={api}
        presetPerson={preset}
        onSaved={offerSaved}
        onClearPreset={() => {
          setPreset(null);
          setComposerKey((value) => value + 1);
        }}
        onOpenPerson={openPerson}
      />
      <RegisterPanel api={api} selectedPersonId={selectedId} refreshToken={listRefresh} onSelect={(person) => openPerson(person.id)} />
      {selectedId && (
        <PersonTimeline
          key={`${selectedId}:${timelineVersion}`}
          api={api}
          personId={selectedId}
          onChanged={bumpList}
          onStartOffer={startOffer}
          onClose={() => setSelectedId(null)}
        />
      )}
      <ReconciliationWorklist api={api} onChanged={bumpList} />
    </RegisterGate>
  );
}
