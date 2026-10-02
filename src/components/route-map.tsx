"use client";

import { useEffect, useRef } from "react";
import type { FlightSnapshot, LatLon } from "@/lib/types";
import "leaflet/dist/leaflet.css";

type LeafletModule = typeof import("leaflet");

function safeCode(code: string) {
  return code.replace(/[^A-Z0-9]/g, "").slice(0, 4) || "•";
}

function asLatLngs(points: LatLon[]) {
  return points.map((point) => [point.lat, point.lon] as [number, number]);
}

function drawFlight(
  L: LeafletModule,
  map: import("leaflet").Map,
  group: import("leaflet").LayerGroup,
  flight: FlightSnapshot,
  fittedKey: { current: string },
) {
  group.clearLayers();

  if (flight.route.length >= 2) {
    L.polyline(asLatLngs(flight.route), {
      color: "#f0b429",
      weight: 2,
      opacity: 0.75,
      dashArray: "5 8",
    }).addTo(group);
  }
  if (flight.track.length >= 2) {
    L.polyline(asLatLngs(flight.track), {
      color: "#9eb7ee",
      weight: 3,
      opacity: 0.95,
    }).addTo(group);
  }

  const stops: Array<{ point: LatLon; code: string; kind: "origin" | "dest" }> = [];
  if (flight.origin.lat != null && flight.origin.lon != null) {
    stops.push({
      point: { lat: flight.origin.lat, lon: flight.origin.lon },
      code: safeCode(flight.origin.code),
      kind: "origin",
    });
  }
  if (flight.destination.lat != null && flight.destination.lon != null) {
    stops.push({
      point: { lat: flight.destination.lat, lon: flight.destination.lon },
      code: safeCode(flight.destination.code),
      kind: "dest",
    });
  }
  for (const stop of stops) {
    const icon = L.divIcon({
      className: "map-tag-wrap",
      html: `<div class="map-tag map-tag-${stop.kind}">${stop.code}</div>`,
      iconSize: [52, 26],
      iconAnchor: [26, 13],
    });
    L.marker([stop.point.lat, stop.point.lon], { icon, keyboard: false, title: stop.code }).addTo(group);
  }

  if (flight.position) {
    const heading = flight.position.heading ?? 0;
    const icon = L.divIcon({
      className: "map-tag-wrap",
      html: `<div class="map-plane" style="transform: rotate(${heading}deg)">▲</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    L.marker([flight.position.lat, flight.position.lon], {
      icon,
      keyboard: false,
      title: "Current position",
      zIndexOffset: 500,
    }).addTo(group);
  }

  const boundsPoints = [
    ...flight.route,
    ...flight.track,
    ...(flight.position ? [flight.position] : []),
  ];
  if (!boundsPoints.length) return;

  const key = `${flight.ident}:${flight.origin.code}:${flight.destination.code}`;
  if (fittedKey.current !== key) {
    map.fitBounds(L.latLngBounds(asLatLngs(boundsPoints)), {
      paddingTopLeft: [28, 52],
      paddingBottomRight: [28, 36],
    });
    fittedKey.current = key;
  }
  requestAnimationFrame(() => map.invalidateSize());
}

export function RouteMap({ flight }: { flight: FlightSnapshot }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const fittedKey = useRef("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    void import("leaflet").then((L) => {
      if (cancelled || !hostRef.current) return;
      if (!mapRef.current) {
        const map = L.map(hostRef.current, { zoomControl: false, attributionControl: true });
        map.attributionControl.setPrefix("");
        const tiles = {
          maxZoom: 16,
          attribution: "Tiles &copy; Esri",
        };
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          tiles,
        ).addTo(map);
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 16, attribution: "" },
        ).addTo(map);
        L.control.zoom({ position: "topright" }).addTo(map);
        mapRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
      }
      const map = mapRef.current;
      const group = layerRef.current;
      if (!map || !group) return;
      drawFlight(L, map, group, flight, fittedKey);
    });

    return () => {
      cancelled = true;
    };
  }, [flight]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedKey.current = "";
    };
  }, []);

  const hasMap = flight.route.length >= 2 || flight.track.length >= 2 || flight.position != null;
  const caption =
    flight.track.length >= 2 && flight.route.length >= 2
      ? "Amber dashes are the planned route. The blue line is where it has flown."
      : flight.track.length >= 2
        ? "The blue line is where this flight has flown."
        : "Amber dashes are the planned route.";

  return (
    <section className="space-y-2" aria-label="En route map">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-sm font-medium text-cream">En route</h2>
        <p className="text-xs text-muted">
          {flight.origin.code} to {flight.destination.code}
        </p>
      </div>
      {hasMap ? (
        <div className="map-frame h-64 w-full sm:h-72">
          <div ref={hostRef} className="h-full w-full" />
        </div>
      ) : (
        <div className="map-frame flex h-36 items-center justify-center px-6 text-center text-sm text-muted">
          A route isn&apos;t available for this flight yet.
        </div>
      )}
      {hasMap ? <p className="px-1 text-xs leading-5 text-muted">{caption}</p> : null}
    </section>
  );
}
