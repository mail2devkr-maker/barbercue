"use client";

import { EMPTY_CHOICE, NEW_NODE, existingNode, type ServiceTree, type TaxonomyChoice } from "../../lib/service-taxonomy";
import styles from "./dashboard.module.css";

/**
 * Category and subcategory for one service. With the shop's category tree it offers the existing categories (and, under the chosen
 * one, its subcategories) plus "A new category…"; without the tree (an older server) it is the plain text box it always was.
 */
export function ServiceTaxonomyPicker({
  tree,
  value,
  onChange,
  idPrefix,
}: {
  tree: ServiceTree | null;
  value: TaxonomyChoice;
  onChange: (next: TaxonomyChoice) => void;
  idPrefix: string;
}) {
  if (!tree) {
    return (
      <div>
        <label className={styles.fieldLabel} htmlFor={`${idPrefix}-category`}>Category (optional)</label>
        <input
          id={`${idPrefix}-category`}
          value={value.newCategory}
          onChange={(e) => onChange({ ...EMPTY_CHOICE, newCategory: e.target.value })}
          maxLength={60}
          className={styles.input}
          placeholder="Men's Hair & Grooming"
        />
      </div>
    );
  }

  const category = tree.find((c) => c.id === value.categoryId) ?? null;
  const addingCategory = value.categoryId === NEW_NODE;
  const addingSub = value.subcategoryId === NEW_NODE;
  const haveCategory = category !== null || (addingCategory && value.newCategory.trim() !== "");
  const duplicateCategory = addingCategory ? existingNode(tree, value.newCategory) : null;
  const duplicateSub = addingSub && category ? existingNode(category.subcategories, value.newSubcategory) : null;

  return (
    <div>
      <label className={styles.fieldLabel} htmlFor={`${idPrefix}-category`}>Category (optional)</label>
      <select
        id={`${idPrefix}-category`}
        className={styles.input}
        value={value.categoryId}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") onChange(EMPTY_CHOICE);
          else if (v === NEW_NODE) onChange({ categoryId: NEW_NODE, newCategory: "", subcategoryId: "", newSubcategory: "" });
          else onChange({ categoryId: v, newCategory: "", subcategoryId: v === value.categoryId ? value.subcategoryId : "", newSubcategory: v === value.categoryId ? value.newSubcategory : "" });
        }}
      >
        <option value="">No category</option>
        {tree.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        <option value={NEW_NODE}>A new category…</option>
      </select>
      {addingCategory && (
        <input
          id={`${idPrefix}-new-category`}
          aria-label="New category name"
          value={value.newCategory}
          onChange={(e) => onChange({ ...value, newCategory: e.target.value })}
          maxLength={60}
          className={styles.input}
          placeholder="Name of the new category"
          autoComplete="off"
        />
      )}
      {duplicateCategory && <p className={styles.rowMeta}>You already have a category called “{duplicateCategory.name}”; that one will be used.</p>}
      {(category !== null || haveCategory) && (
        <>
          <label className={styles.fieldLabel} htmlFor={`${idPrefix}-subcategory`}>Subcategory (optional)</label>
          <select
            id={`${idPrefix}-subcategory`}
            className={styles.input}
            value={value.subcategoryId}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") onChange({ ...value, subcategoryId: "", newSubcategory: "" });
              else if (v === NEW_NODE) onChange({ ...value, subcategoryId: NEW_NODE, newSubcategory: "" });
              else onChange({ ...value, subcategoryId: v, newSubcategory: "" });
            }}
          >
            <option value="">No subcategory</option>
            {(category?.subcategories ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            <option value={NEW_NODE}>A new subcategory…</option>
          </select>
          {addingSub && (
            <input
              id={`${idPrefix}-new-subcategory`}
              aria-label="New subcategory name"
              value={value.newSubcategory}
              onChange={(e) => onChange({ ...value, newSubcategory: e.target.value })}
              maxLength={60}
              className={styles.input}
              placeholder="Name of the new subcategory"
              autoComplete="off"
            />
          )}
          {duplicateSub && <p className={styles.rowMeta}>This category already has “{duplicateSub.name}”; that one will be used.</p>}
        </>
      )}
    </div>
  );
}
