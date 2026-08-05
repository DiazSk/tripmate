"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Stop } from "@/lib/types";
import { geocodeDestination } from "@/lib/weather";

// Leaflet's default marker icons break under bundlers unless repointed at CDN assets.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function validCoords(stop: { lat: number; lng: number }) {
  return (
    typeof stop.lat === "number" &&
    typeof stop.lng === "number" &&
    !Number.isNaN(stop.lat) &&
    !Number.isNaN(stop.lng)
  );
}

function FlyTo({ position }: { position: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(position, 15, { duration: 1.2 });
    }
  }, [position, map]);
  return null;
}

function SelectedMarker({ stop }: { stop: Stop }) {
  const markerRef = useRef<L.Marker | null>(null);
  useEffect(() => {
    markerRef.current?.openPopup();
  }, [stop]);

  return (
    <Marker ref={markerRef} position={[stop.lat, stop.lng]}>
      <Popup>
        <strong>{stop.name}</strong>
        <br />
        {stop.note}
      </Popup>
    </Marker>
  );
}

export default function ItineraryMap({
  destination,
  selectedStop,
}: {
  destination: string;
  selectedStop?: Stop | null;
}) {
  const [center, setCenter] = useState<[number, number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    geocodeDestination(destination).then((geo) => {
      if (!cancelled && geo) setCenter([geo.lat, geo.lon]);
    });
    return () => {
      cancelled = true;
    };
  }, [destination]);

  if (!center) {
    return (
      <div className="flex h-80 items-center justify-center rounded-2xl border border-card-border bg-card text-sm text-muted shadow-[0_1px_2px_rgba(32,28,25,0.04),0_8px_24px_-12px_rgba(32,28,25,0.12)]">
        Loading map…
      </div>
    );
  }

  const selectedPosition =
    selectedStop && validCoords(selectedStop)
      ? ([selectedStop.lat, selectedStop.lng] as [number, number])
      : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-card-border shadow-[0_1px_2px_rgba(32,28,25,0.04),0_8px_24px_-12px_rgba(32,28,25,0.12)]">
      <MapContainer
        center={center}
        zoom={12}
        className="h-80 w-full"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FlyTo position={selectedPosition} />
        {selectedStop && selectedPosition && <SelectedMarker stop={selectedStop} />}
      </MapContainer>
    </div>
  );
}
