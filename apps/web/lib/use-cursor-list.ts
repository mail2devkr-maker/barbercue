"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { entityErrorText, listQuery } from "./inventory";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CursorListState<T> {
  items: T[];
  /** True until the first page of the current filters has arrived. */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
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
export function useCursorList<T>(path: string, params: Record<string, string | boolean | null | undefined>, enabled: boolean = true): CursorListState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++generation.current;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const page = await apiFetch<CursorPage<T>>(`${path}?${listQuery(JSON.parse(paramsKey) as Record<string, string | boolean | null | undefined>, null)}`);
        if (cancelled || mine !== generation.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore && page.nextCursor !== null);
      } catch (err) {
        if (cancelled || mine !== generation.current) return;
        setItems([]);
        setCursor(null);
        setHasMore(false);
        setError(err instanceof ApiError ? entityErrorText(err.code, err.message) : "Could not load this list.");
      } finally {
        if (!cancelled && mine === generation.current) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, paramsKey, enabled, version]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setError(null);
    apiFetch<CursorPage<T>>(`${path}?${listQuery(JSON.parse(paramsKey) as Record<string, string | boolean | null | undefined>, cursor)}`)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore && page.nextCursor !== null);
      })
      .catch((err: unknown) => {
        if (mine !== generation.current) return;
        if (err instanceof ApiError && err.code === "CURSOR_FILTER_MISMATCH") {
          setNotice("The list changed while you were paging, so it was reloaded from the start.");
          setVersion((v) => v + 1);
        } else {
          setError(err instanceof ApiError ? entityErrorText(err.code, err.message) : "Could not load more.");
        }
      })
      .finally(() => {
        if (mine === generation.current) setLoadingMore(false);
      });
  }, [cursor, loadingMore, path, paramsKey]);

  const reload = useCallback(() => {
    setNotice(null);
    setVersion((v) => v + 1);
  }, []);

  return { items, loading, loadingMore, error, notice, hasMore, loadMore, reload };
}
