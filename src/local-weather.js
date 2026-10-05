const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_LOCATION = Object.freeze({
  name: "Ga-Sekororo, Maruleng, Limpopo",
  latitude: -24.21667,
  longitude: 30.4,
  timezone: "Africa/Johannesburg",
  gazetteerUrl: "https://www.geonames.org/1002777"
});
export const WEATHER_PROVIDER = Object.freeze({
  name: "Open-Meteo",
  description: "Numerical weather-model guidance, not a local observing-station reading or an official warning.",
  websiteUrl: "https://open-meteo.com/",
  apiDocsUrl: "https://open-meteo.com/en/docs",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/"
});

const TEMPORAL_PHRASES = /^(?:today|tomorrow|tonight|this|next|coming|the\s+(?:next|coming|week|morning|afternoon|evening)|my\s+(?:area|location)|here|me|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+)/i;
const LOCAL_PLACE_NAMES = /\b(?:ga[ -]?sekororo|sekororo|ga[ -]?mamahlola|metz|moetladimo|mahlakung|tzaneen|mopani|limpopo)\b/i;
const WEATHER_TERMS = /\b(?:weather|forecast|rain|rainfall|temperature|wind|thunderstorm|sunny|cloudy)\b/i;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildWeatherForecastUrl() {
  const url = new URL(FORECAST_ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(WEATHER_LOCATION.latitude),
    longitude: String(WEATHER_LOCATION.longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
    timezone: WEATHER_LOCATION.timezone,
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
    forecast_days: "7"
  }).toString();
  return url.href;
}

export function shouldFetchSekororoWeather(question) {
  const text = String(question || "");
  if (!WEATHER_TERMS.test(text)) return false;
  if (LOCAL_PLACE_NAMES.test(text)) return true;
  const locationCues = [...text.matchAll(/\b(?:in|at|around|near|for)\s+([a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*){0,2})/gi)];
  const explicitPlace = locationCues.reverse().map(match => match[1].trim()).find(value => !TEMPORAL_PHRASES.test(value));
  return !explicitPlace;
}

function pick(list, index) {
  return Array.isArray(list) ? finiteNumber(list[index]) : null;
}

export function describeWeatherCode(code) {
  const labels = new Map([
    [0, "clear"], [1, "mainly clear"], [2, "partly cloudy"], [3, "overcast"], [45, "fog"], [48, "rime fog"],
    [51, "light drizzle"], [53, "drizzle"], [55, "heavy drizzle"], [56, "freezing drizzle"], [57, "heavy freezing drizzle"],
    [61, "light rain"], [63, "rain"], [65, "heavy rain"], [66, "freezing rain"], [67, "heavy freezing rain"],
    [71, "light snow"], [73, "snow"], [75, "heavy snow"], [77, "snow grains"], [80, "light rain showers"],
    [81, "rain showers"], [82, "heavy rain showers"], [85, "light snow showers"], [86, "heavy snow showers"],
    [95, "thunderstorm"], [96, "thunderstorm with hail"], [99, "thunderstorm with heavy hail"]
  ]);
  return labels.get(finiteNumber(code)) || "conditions not reported";
}

export async function fetchSekororoWeather({ fetcher = globalThis.fetch, now = new Date() } = {}) {
  if (typeof fetcher !== "function") throw new Error("Forecast fetch is unavailable.");
  const response = await fetcher(buildWeatherForecastUrl(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 900, cacheEverything: true },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response?.ok) throw new Error(`Forecast provider returned HTTP ${response?.status || "error"}.`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || payload.timezone !== WEATHER_LOCATION.timezone || !payload.current || !Array.isArray(payload.daily?.time)) {
    throw new Error("Forecast provider returned an unexpected response.");
  }
  const temperatureC = finiteNumber(payload.current.temperature_2m);
  if (temperatureC === null || payload.daily.time.length < 1) throw new Error("Forecast provider omitted current or daily weather data.");

  const daily = payload.daily.time.slice(0, 7).map((date, index) => ({
    date: String(date),
    weatherCode: pick(payload.daily.weather_code, index),
    weatherDescription: describeWeatherCode(pick(payload.daily.weather_code, index)),
    minimumC: pick(payload.daily.temperature_2m_min, index),
    maximumC: pick(payload.daily.temperature_2m_max, index),
    precipitationMm: pick(payload.daily.precipitation_sum, index),
    precipitationProbabilityPercent: pick(payload.daily.precipitation_probability_max, index),
    maximumWindKmh: pick(payload.daily.wind_speed_10m_max, index)
  }));

  return {
    location: WEATHER_LOCATION.name,
    locationPoint: { latitude: WEATHER_LOCATION.latitude, longitude: WEATHER_LOCATION.longitude, referenceUrl: WEATHER_LOCATION.gazetteerUrl },
    provider: WEATHER_PROVIDER.name,
    providerDescription: WEATHER_PROVIDER.description,
    providerUrl: WEATHER_PROVIDER.websiteUrl,
    providerDocsUrl: WEATHER_PROVIDER.apiDocsUrl,
    licenseUrl: WEATHER_PROVIDER.licenseUrl,
    forecastUrl: buildWeatherForecastUrl(),
    timezone: WEATHER_LOCATION.timezone,
    retrievedAt: new Date(now).toISOString(),
    validTime: String(payload.current.time || ""),
    utcOffsetSeconds: finiteNumber(payload.utc_offset_seconds),
    current: {
      temperatureC,
      apparentTemperatureC: finiteNumber(payload.current.apparent_temperature),
      relativeHumidityPercent: finiteNumber(payload.current.relative_humidity_2m),
      precipitationMm: finiteNumber(payload.current.precipitation),
      weatherCode: finiteNumber(payload.current.weather_code),
      weatherDescription: describeWeatherCode(payload.current.weather_code),
      windSpeedKmh: finiteNumber(payload.current.wind_speed_10m)
    },
    daily
  };
}
