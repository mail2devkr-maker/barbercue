"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../../../lib/dashboard-flags";
import s from "./vi.module.css";

export interface GeoPoint {
  key: string;
  lat: number;
  lng: number;
  value: number;
  level: string;
  tooltip: string;
}

/**
 * Demand heat map: one circle per city at the city's centre (from FastQue's own cities table), sized by
 * visitors and coloured by opportunity. City centres only: visitor positions are never plotted.
 */
export function GeoMap({ points, onSelect }: { points: GeoPoint[]; onSelect?: (key: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return;
      L.current = mod;
      map.current = mod.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([22.5, 79], 4);
      mod.tileLayer(MAP_TILE_URL, { attribution: MAP_TILE_ATTRIBUTION, maxZoom: 12 }).addTo(map.current);
      layer.current = mod.layerGroup().addTo(map.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !L.current || !layer.current || !map.current) return;
    const mod = L.current;
    const group = layer.current;
    group.clearLayers();
    const max = Math.max(1, ...points.map((p) => p.value));
    for (const p of points) {
      const color = p.level === "HIGH" ? "#ff6f91" : p.level === "MEDIUM" ? "#ffc566" : "#6bb8ff";
      mod
        .circleMarker([p.lat, p.lng], { radius: 6 + Math.sqrt(p.value / max) * 22, color, weight: 1, fillColor: color, fillOpacity: 0.45 })
        .bindTooltip(p.tooltip)
        .on("click", () => onSelect?.(p.key))
        .addTo(group);
    }
    const m = map.current;
    const fit = () => {
      m.invalidateSize();
      if (points.length) m.fitBounds(mod.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.3), { maxZoom: 7 });
    };
    fit();
    // The container may still be settling (fonts, sidebar, hidden tab): refit whenever its size changes.
    const ro = new ResizeObserver(() => fit());
    if (el.current) ro.observe(el.current);
    return () => ro.disconnect();
  }, [points, ready, onSelect]);

  return <div ref={el} className={s.map} role="region" aria-label="Map of visitor demand by city (city centres only)" />;
}
