"use client";

import { useCallback, useRef } from "react";
import { newIdempotencyKey } from "../idempotency";

/**
 * One idempotency key per distinct request body. A double click, a retry after a network error, or
 * a second tab-press sends the same body and therefore the same key, so the server records exactly
 * one result. Changing any input produces a new body, hence a new key; `release` is called after a
 * definitive outcome so the next intentional action starts fresh.
 */
export function useIdempotencyKeys() {
  const keys = useRef(new Map<string, string>());

  const keyFor = useCallback((body: unknown): string => {
    const signature = JSON.stringify(body);
    let key = keys.current.get(signature);
    if (!key) {
      key = newIdempotencyKey();
      keys.current.set(signature, key);
    }
    return key;
  }, []);

  const release = useCallback((body: unknown): void => {
    keys.current.delete(JSON.stringify(body));
  }, []);

  return { keyFor, release };
}
