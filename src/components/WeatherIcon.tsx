import {
  Sun,
  CloudSun,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Umbrella,
} from "lucide-react";
import { DayWeather } from "@/lib/weather";

const DRIZZLE_CODES = [51, 53, 55, 56, 57];
const RAIN_CODES = [61, 63, 65, 66, 67, 80, 81, 82];
const SNOW_CODES = [71, 73, 75, 77, 85, 86];
const STORM_CODES = [95, 96, 99];
const FOG_CODES = [45, 48];
const PARTLY_CLOUDY_CODES = [1, 2, 3];

const HIGH_RAIN_THRESHOLD = 50;

type Condition = "umbrella" | "storm" | "snow" | "rain" | "drizzle" | "fog" | "partly-cloudy" | "clear";

function pickCondition(weather?: DayWeather | null): Condition {
  if (!weather) return "clear";
  const { weatherCode, precipitationProbability } = weather;
  if (precipitationProbability != null && precipitationProbability >= HIGH_RAIN_THRESHOLD) {
    return "umbrella";
  }
  if (weatherCode == null) return "clear";
  if (STORM_CODES.includes(weatherCode)) return "storm";
  if (SNOW_CODES.includes(weatherCode)) return "snow";
  if (RAIN_CODES.includes(weatherCode)) return "rain";
  if (DRIZZLE_CODES.includes(weatherCode)) return "drizzle";
  if (FOG_CODES.includes(weatherCode)) return "fog";
  if (PARTLY_CLOUDY_CODES.includes(weatherCode)) return "partly-cloudy";
  return "clear";
}

/** High rain chance or an extreme temperature — days where indoor activities
 *  are the safer bet, used to softly tint the day card. */
export function isIndoorRecommended(weather?: DayWeather | null): boolean {
  if (!weather) return false;
  const highRain =
    weather.precipitationProbability != null &&
    weather.precipitationProbability >= HIGH_RAIN_THRESHOLD;
  const extremeTemp = weather.tempMaxC >= 35 || weather.tempMinC <= 0;
  return highRain || extremeTemp;
}

export default function WeatherIcon({
  weather,
  className,
}: {
  weather?: DayWeather | null;
  className?: string;
}) {
  switch (pickCondition(weather)) {
    case "umbrella":
      return <Umbrella className={className} />;
    case "storm":
      return <CloudLightning className={className} />;
    case "snow":
      return <CloudSnow className={className} />;
    case "rain":
      return <CloudRain className={className} />;
    case "drizzle":
      return <CloudDrizzle className={className} />;
    case "fog":
      return <CloudFog className={className} />;
    case "partly-cloudy":
      return <CloudSun className={className} />;
    case "clear":
      return <Sun className={className} />;
  }
}
