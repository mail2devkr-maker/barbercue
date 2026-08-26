/**
 * The seam between SalonPhotosService (and any future upload consumer) and wherever bytes
 * actually live. ObjectStorageService picks exactly one concrete driver at boot from whichever
 * environment variables are present and never exposes the choice to its callers — SalonPhotosService
 * calls `putPublicObject`/`deleteObject` and does not know or care whether that resolves to a
 * Railway volume, R2, or (in tests) nothing at all.
 *
 * Adding a new backend later — R2 for multi-region, GCS, whatever — means writing one more class
 * that implements this interface and one more branch in ObjectStorageService's driver selection.
 * It never means touching the Photo model or the frontend, which only ever see the resulting URL.
 */
export interface StorageDriver {
  /**
   * Stores `body` under `key` and returns the https URL a customer's browser will load it from.
   * `contentType` must be the caller's sniffed type (see image-signature.ts), never a client's
   * declared one — it is what gets served back on every request for this object.
   */
  putPublicObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string>;

  /**
   * Best-effort delete of the object a previously-returned URL points at. Returns quietly (no
   * throw) when `url` does not belong to this driver — SalonPhotosService.remove() calls this for
   * every removed Photo regardless of whether that photo was uploaded or linked, and a linked
   * photo's URL living on someone else's CDN must never be touched.
   */
  deleteObject(url: string): Promise<void>;
}
