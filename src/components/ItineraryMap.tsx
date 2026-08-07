"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DayPlan } from "@/lib/types";

// Leaflet's default marker icons break under bundlers unless repointed at CDN assets.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const highlightIcon = L.divIcon({
  className: "",
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#ea580c;border:3px solid white;box-shadow:0 0 0 4px rgba(234,88,12,0.35)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export default function ItineraryMap({
  days,
  hoveredStop,
}: {
  days: DayPlan[];
  hoveredStop?: string | null;
}) {
  const stops = days.flatMap((day, di) =>
    day.stops
      .map((stop, si) => ({ ...stop, key: `${di}-${si}` }))
      .filter(validCoords)
  );
  if (stops.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-xl border border-stone-200 bg-stone-50 text-sm text-stone-500">
        No mappable stops
      </div>
    );
  }

  const center: [number, number] = [stops[0].lat, stops[0].lng];

  return (
    <MapContainer
      center={center}
      zoom={12}
      className="h-80 w-full rounded-xl border border-stone-200"
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {stops.map((stop) => (
        <Marker
          key={stop.key}
          position={[stop.lat, stop.lng]}
          icon={stop.key === hoveredStop ? highlightIcon : undefined}
        >
          <Popup>
            <strong>{stop.name}</strong>
            <br />
            {stop.note}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function validCoords(stop: { lat: number; lng: number }) {
  return (
    typeof stop.lat === "number" &&
    typeof stop.lng === "number" &&
    !Number.isNaN(stop.lat) &&
    !Number.isNaN(stop.lng)
  );
}
