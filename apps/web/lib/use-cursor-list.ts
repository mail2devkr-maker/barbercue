"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { entityErrorText, listQuery } from "./inventory";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  /** Some lists (the customer directory) send only a cursor; then more exists exactly when there is a cursor. */
  hasMore?: boolean;
}

export interface CursorListOptions {
  /** Error codes that mean "this cursor no longer matches the filters"; the list restarts instead of failing. */
  mismatchCodes?: readonly string[];
  /** Words for a server error code; defaults to the inventory wording. Pass a stable function (a module-level one): a new function reloads the list. */
  errorText?: (code: string | undefined, message: string) => string;
  /**
   * A stable key per row. When given, a "load more" page that adds no row not already shown is a server paging fault (the same page
   * again): the rows are not duplicated and paging stops with a notice, instead of repeating forever.
   */
  keyOf?: (item: never) => string;
}

export const REPEATED_PAGE_NOTICE = "The server sent the same rows again, so paging stopped. Narrow your search or change the sort to see the rest.";

const DEFAULT_MISMATCH_CODES: readonly string[] = ["CURSOR_FILTER_MISMATCH"];

function moreAvailable<T>(page: CursorPage<T>): boolean {
  return page.nextCursor !== null && (page.hasMore ?? true);
}

export interface CursorListState<T> {
  items: T[];
  /** True until the first page of the current filters has arrived. */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** HTTP status of the failed first page (404 when the server does not have this route yet), else null. */
  errorStatus: number | null;
  /** A one-off remark, for example that the list was reloaded because its filters changed under a cursor. */
  notice: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * A server list with a signed cursor: the first page loads whenever the path or filters change, "load more" continues with the
 * cursor the server issued for exactly those filters, and a response for filters that have since changed is dropped. If the
 * server says the cursor no longer matches the filters the list restarts from the first page instead of mixing pages.
 */
export function useCursorList<T>(
  path: string,
  params: Record<string, string | boolean | null | undefined>,
  enabled: boolean = true,
  options: CursorListOptions = {},
): CursorListState<T> {
  const mismatchCodes = options.mismatchCodes ?? DEFAULT_MISMATCH_CODES;
  const errorText = options.errorText ?? entityErrorText;
  const keyOf = options.keyOf as ((item: T) => string) | undefined;
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const itemsRef = useRef<T[]>([]);
  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++generation.current;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setErrorStatus(null);
      try {
        const page = await apiFetch<CursorPage<T>>(`${path}?${listQuery(JSON.parse(paramsKey) as Record<string, string | boolean | null | undefined>, null)}`);
        if (cancelled || mine !== generation.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(moreAvailable(page));
      } catch (err) {
        if (cancelled || mine !== generation.current) return;
        setItems([]);
        setCursor(null);
        setHasMore(false);
        setError(err instanceof ApiError ? errorText(err.code, err.message) : "Could not load this list.");
        setErrorStatus(err instanceof ApiError ? err.status : null);
      } finally {
        if (!cancelled && mine === generation.current) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, paramsKey, enabled, version, errorText]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setError(null);
    apiFetch<CursorPage<T>>(`${path}?${listQuery(JSON.parse(paramsKey) as Record<string, string | boolean | null | undefined>, cursor)}`)
      .then((page) => {
        if (mine !== generation.current) return;
        if (keyOf) {
          const shown = new Set(itemsRef.current.map(keyOf));
          const fresh = page.items.filter((item) => !shown.has(keyOf(item)));
          if (page.items.length > 0 && fresh.length === 0) {
            setNotice(REPEATED_PAGE_NOTICE);
            setCursor(null);
            setHasMore(false);
            return;
          }
          setItems((prev) => [...prev, ...fresh]);
        } else {
          setItems((prev) => [...prev, ...page.items]);
        }
        setCursor(page.nextCursor);
        setHasMore(moreAvailable(page));
      })
      .catch((err: unknown) => {
        if (mine !== generation.current) return;
        if (err instanceof ApiError && mismatchCodes.includes(err.code)) {
          setNotice("The list changed while you were paging, so it was reloaded from the start.");
          setVersion((v) => v + 1);
        } else {
          setError(err instanceof ApiError ? errorText(err.code, err.message) : "Could not load more.");
        }
      })
      .finally(() => {
        if (mine === generation.current) setLoadingMore(false);
      });
  }, [cursor, loadingMore, path, paramsKey, mismatchCodes, errorText, keyOf]);

  const reload = useCallback(() => {
    setNotice(null);
    setVersion((v) => v + 1);
  }, []);

  return { items, loading, loadingMore, error, errorStatus, notice, hasMore, loadMore, reload };
}
