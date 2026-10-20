"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { SalonServiceDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  existingNode,
  parseServiceTree,
  serviceCounts,
  sortedTree,
  taxonomyErrorText,
  validateNodeName,
  type ServiceTree,
} from "../../lib/service-taxonomy";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

type Editing = { kind: "category"; id: string; name: string } | { kind: "subcategory"; categoryId: string; id: string; name: string } | null;
type Pending = { kind: "category"; id: string; name: string } | { kind: "subcategory"; categoryId: string; id: string; name: string } | null;

/**
 * The shop's own category tree: add, rename and delete categories and subcategories. Renaming keeps the id and updates the label on
 * the services in it; bookings and invoices already made keep the names they were made with. A category can be deleted only when
 * nothing is in it. The server enforces both; this page only says so first.
 */
export function ServiceCategoryManager({ salonId }: { salonId: string }) {
  const root = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const treePath = `${root}/service-categories`;
  const [tree, setTree] = useState<ServiceTree | null>(null);
  const [services, setServices] = useState<SalonServiceDto[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newSub, setNewSub] = useState<{ categoryId: string; name: string } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    try {
      const [rawTree, svc] = await Promise.all([
        apiFetch<unknown>(treePath),
        apiFetch<SalonServiceDto[]>(`${root}/${DASHBOARD_PATHS.services}`),
      ]);
      const parsed = parseServiceTree(rawTree);
      if (!parsed) {
        setState("error");
        setLoadError("The server sent categories in a form this page cannot read.");
        return;
      }
      setTree(sortedTree(parsed));
      setServices(Array.isArray(svc) ? svc : []);
      setState("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setState("missing");
      else {
        setState("error");
        setLoadError(err instanceof ApiError ? taxonomyErrorText(err.code, err.message) : "Could not load your categories.");
      }
    }
  }, [treePath, root]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function write(request: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request();
      setNotice(done);
      setEditing(null);
      setPending(null);
      setNewCategory("");
      setNewSub(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? taxonomyErrorText(err.code, err.message) : "That did not go through. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  function addCategory() {
    const problem = validateNodeName(newCategory);
    if (problem) return setError(problem);
    const dup = tree ? existingNode(tree, newCategory) : null;
    if (dup) return setError(`You already have a category called “${dup.name}”.`);
    void write(() => apiFetch(treePath, { method: "POST", body: JSON.stringify({ name: newCategory.trim() }) }), `${newCategory.trim()} added.`);
  }

  function addSubcategory() {
    if (!newSub) return;
    const problem = validateNodeName(newSub.name);
    if (problem) return setError(problem);
    const parent = tree?.find((c) => c.id === newSub.categoryId);
    const dup = parent ? existingNode(parent.subcategories, newSub.name) : null;
    if (dup) return setError(`This category already has “${dup.name}”.`);
    void write(
      () => apiFetch(`${treePath}/${newSub.categoryId}/subcategories`, { method: "POST", body: JSON.stringify({ name: newSub.name.trim() }) }),
      `${newSub.name.trim()} added.`,
    );
  }

  function saveRename() {
    if (!editing) return;
    const problem = validateNodeName(editing.name);
    if (problem) return setError(problem);
    if (editing.kind === "category") {
      const dup = tree ? existingNode(tree, editing.name, editing.id) : null;
      if (dup) return setError(`You already have a category called “${dup.name}”.`);
      void write(() => apiFetch(`${treePath}/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name.trim() }) }), `Renamed to ${editing.name.trim()}.`);
    } else {
      const parent = tree?.find((c) => c.id === editing.categoryId);
      const dup = parent ? existingNode(parent.subcategories, editing.name, editing.id) : null;
      if (dup) return setError(`This category already has “${dup.name}”.`);
      void write(
        () => apiFetch(`${treePath}/${editing.categoryId}/subcategories/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name.trim() }) }),
        `Renamed to ${editing.name.trim()}.`,
      );
    }
  }

  function confirmDelete() {
    if (!pending) return;
    if (pending.kind === "category") void write(() => apiFetch(`${treePath}/${pending.id}`, { method: "DELETE" }), `${pending.name} deleted.`);
    else void write(() => apiFetch(`${treePath}/${pending.categoryId}/subcategories/${pending.id}`, { method: "DELETE" }), `${pending.name} deleted.`);
  }

  const counts = tree ? serviceCounts(tree, services) : null;
  const back = (
    <Link href={`/dashboard/salons/${salonId}/services`} className={styles.backLink}>← Back to services</Link>
  );

  if (state === "loading") return <main className={styles.page}>{back}<p className={styles.loadingText}>Loading…</p></main>;
  if (state === "missing") {
    return (
      <main className={styles.page}>
        {back}
        <h1 className={styles.pageTitle}>Service categories</h1>
        <p className={styles.emptyState}>Managing categories is not available yet on this server. You can still type a category name when you add or edit a service.</p>
      </main>
    );
  }
  if (state === "error" || !tree || !counts) {
    return (
      <main className={styles.page}>
        {back}
        <h1 className={styles.pageTitle}>Service categories</h1>
        <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{loadError ?? "Could not load your categories."}</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      {back}
      <h1 className={styles.pageTitle}>Service categories</h1>
      <p className={styles.pageSubtitle}>
        Group your services into categories, and categories into subcategories, such as Hair › Cut. Renaming a category updates the label on its
        services; bookings and invoices already made keep the names they had. A category or subcategory can be deleted only when it is empty.
      </p>

      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      <div role="status" aria-live="polite">{notice && <p className={`${styles.banner} ${styles.bannerNotice}`}>{notice}</p>}</div>

      <form onSubmit={(e) => { e.preventDefault(); addCategory(); }} noValidate style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", margin: "12px 0" }}>
        <div style={{ flex: "1 1 220px" }}>
          <label className={styles.fieldLabel} htmlFor="new-category">New category</label>
          <input id="new-category" className={styles.input} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={60} placeholder="Hair" autoComplete="off" />
        </div>
        <Button type="submit" disabled={busy}>Add category</Button>
      </form>

      {tree.length === 0 && <p className={styles.emptyState}>You have no categories yet. Add one above, or type a category when you add a service.</p>}

      <ul className={styles.rowList}>
        {tree.map((category) => {
          const inCategory = counts.categories.get(category.id) ?? 0;
          const renaming = editing?.kind === "category" && editing.id === category.id;
          return (
            <li key={category.id} className={styles.row} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                {renaming && editing ? (
                  <form onSubmit={(e) => { e.preventDefault(); saveRename(); }} noValidate style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input aria-label={`New name for ${category.name}`} className={styles.input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} autoComplete="off" />
                    <Button type="submit" disabled={busy}>Save</Button>
                    <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
                  </form>
                ) : (
                  <span className={styles.rowTitle}>{category.name} <span className={styles.rowMeta}>· {inCategory} service{inCategory === 1 ? "" : "s"}</span></span>
                )}
                {!renaming && (
                  <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button type="button" variant="outline" onClick={() => { setError(null); setEditing({ kind: "category", id: category.id, name: category.name }); }} disabled={busy}>Rename</Button>
                    <Button type="button" variant="outline" onClick={() => setNewSub({ categoryId: category.id, name: "" })} disabled={busy}>Add subcategory</Button>
                    <Button type="button" variant="outline" onClick={() => setPending({ kind: "category", id: category.id, name: category.name })} disabled={busy}>Delete</Button>
                  </span>
                )}
              </div>
              {pending?.kind === "category" && pending.id === category.id && (
                <div role="alertdialog" aria-label={`Delete ${category.name}`} className={`${styles.banner} ${styles.bannerWarning}`}>
                  {inCategory > 0 || category.subcategories.length > 0
                    ? `${category.name} still has ${inCategory} service${inCategory === 1 ? "" : "s"}${category.subcategories.length > 0 ? ` and ${category.subcategories.length} subcategor${category.subcategories.length === 1 ? "y" : "ies"}` : ""}; the server will refuse to delete it until they are moved or removed. `
                    : `Delete ${category.name}? `}
                  <Button type="button" variant="outline" onClick={confirmDelete} disabled={busy}>Delete {category.name}</Button>{" "}
                  <Button type="button" variant="outline" onClick={() => setPending(null)} disabled={busy}>Keep it</Button>
                </div>
              )}
              {newSub?.categoryId === category.id && (
                <form onSubmit={(e) => { e.preventDefault(); addSubcategory(); }} noValidate style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input aria-label={`New subcategory of ${category.name}`} className={styles.input} value={newSub.name} onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} maxLength={60} placeholder="Cut" autoComplete="off" />
                  <Button type="submit" disabled={busy}>Add</Button>
                  <Button type="button" variant="outline" onClick={() => setNewSub(null)} disabled={busy}>Cancel</Button>
                </form>
              )}
              {category.subcategories.length > 0 && (
                <ul className={styles.rowList} style={{ marginLeft: 16 }}>
                  {category.subcategories.map((sub) => {
                    const inSub = counts.subcategories.get(sub.id) ?? 0;
                    const renamingSub = editing?.kind === "subcategory" && editing.id === sub.id;
                    return (
                      <li key={sub.id} className={styles.row} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                          {renamingSub && editing ? (
                            <form onSubmit={(e) => { e.preventDefault(); saveRename(); }} noValidate style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <input aria-label={`New name for ${sub.name}`} className={styles.input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} autoComplete="off" />
                              <Button type="submit" disabled={busy}>Save</Button>
                              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
                            </form>
                          ) : (
                            <span>{sub.name} <span className={styles.rowMeta}>· {inSub} service{inSub === 1 ? "" : "s"}</span></span>
                          )}
                          {!renamingSub && (
                            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <Button type="button" variant="outline" onClick={() => { setError(null); setEditing({ kind: "subcategory", categoryId: category.id, id: sub.id, name: sub.name }); }} disabled={busy}>Rename</Button>
                              <Button type="button" variant="outline" onClick={() => setPending({ kind: "subcategory", categoryId: category.id, id: sub.id, name: sub.name })} disabled={busy}>Delete</Button>
                            </span>
                          )}
                        </div>
                        {pending?.kind === "subcategory" && pending.id === sub.id && (
                          <div role="alertdialog" aria-label={`Delete ${sub.name}`} className={`${styles.banner} ${styles.bannerWarning}`}>
                            {inSub > 0 ? `${sub.name} still has ${inSub} service${inSub === 1 ? "" : "s"}; the server will refuse to delete it until they are moved. ` : `Delete ${sub.name}? `}
                            <Button type="button" variant="outline" onClick={confirmDelete} disabled={busy}>Delete {sub.name}</Button>{" "}
                            <Button type="button" variant="outline" onClick={() => setPending(null)} disabled={busy}>Keep it</Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
