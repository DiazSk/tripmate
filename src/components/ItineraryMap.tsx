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

export default function ItineraryMap({ days }: { days: DayPlan[] }) {
  const stops = days.flatMap((d) => d.stops.filter(validCoords));
  if (stops.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-500">
        No mappable stops
      </div>
    );
  }

  const center: [number, number] = [stops[0].lat, stops[0].lng];

  return (
    <MapContainer
      center={center}
      zoom={12}
      className="h-80 w-full rounded-lg"
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {stops.map((stop, i) => (
        <Marker key={i} position={[stop.lat, stop.lng]}>
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
