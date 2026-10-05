const weatherStatus = document.getElementById("weatherStatus");
const weatherCurrent = document.getElementById("weatherCurrent");
const weatherDays = document.getElementById("weatherDays");
const sourceRoot = document.getElementById("communitySources");
const placesRoot = document.getElementById("communityPlaces");
const refreshWeatherButton = document.getElementById("refreshWeather");

const weatherLabels = new Map([
  [0, "Clear"], [1, "Mainly clear"], [2, "Partly cloudy"], [3, "Overcast"],
  [45, "Fog"], [48, "Depositing rime fog"], [51, "Light drizzle"], [53, "Drizzle"], [55, "Heavy drizzle"],
  [56, "Freezing drizzle"], [57, "Heavy freezing drizzle"], [61, "Light rain"], [63, "Rain"], [65, "Heavy rain"],
  [66, "Freezing rain"], [67, "Heavy freezing rain"], [71, "Light snow"], [73, "Snow"], [75, "Heavy snow"],
  [77, "Snow grains"], [80, "Light rain showers"], [81, "Rain showers"], [82, "Heavy rain showers"],
  [85, "Light snow showers"], [86, "Heavy snow showers"], [95, "Thunderstorm"],
  [96, "Thunderstorm with hail"], [99, "Thunderstorm with heavy hail"]
]);

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(text ?? "");
  parent.appendChild(node);
  return node;
}

function formatLocalDate(value, options = {}) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", ...options }).format(date);
}

function formatLocalWeatherTime(value) {
  const text = String(value || "");
  if (!text) return "valid time not provided";
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}+02:00`;
  return formatLocalDate(zoned, { dateStyle: "medium", timeStyle: "short" });
}

function weatherDescription(code) {
  return weatherLabels.get(Number(code)) || "Conditions not reported";
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function renderWeather(data) {
  weatherCurrent.replaceChildren();
  weatherDays.replaceChildren();
  const current = data?.current;
  if (!current || !hasNumericValue(current.temperatureC)) {
    throw new Error("The forecast did not include a model snapshot.");
  }

  const currentCard = document.createElement("div");
  currentCard.className = "weather-current-card";
  addText(currentCard, "p", "weather-current-label", `Forecast model · ${weatherDescription(current.weatherCode)}`);
  addText(currentCard, "p", "weather-current-temperature", `${Math.round(Number(current.temperatureC))}°C`);
  const details = [];
  if (hasNumericValue(current.apparentTemperatureC)) details.push(`Feels like ${Math.round(Number(current.apparentTemperatureC))}°C`);
  if (hasNumericValue(current.relativeHumidityPercent)) details.push(`Humidity ${Math.round(Number(current.relativeHumidityPercent))}%`);
  if (hasNumericValue(current.windSpeedKmh)) details.push(`Wind ${Math.round(Number(current.windSpeedKmh))} km/h`);
  addText(currentCard, "p", "weather-current-details", details.join(" · "));
  weatherCurrent.appendChild(currentCard);

  for (const day of Array.isArray(data.daily) ? data.daily.slice(0, 3) : []) {
    const card = document.createElement("article");
    card.className = "weather-day-card";
    addText(card, "h3", "", formatLocalDate(day.date, { weekday: "short", day: "numeric", month: "short" }));
    addText(card, "p", "weather-day-description", weatherDescription(day.weatherCode));
    if (hasNumericValue(day.minimumC) && hasNumericValue(day.maximumC)) {
      addText(card, "p", "weather-day-range", `${Math.round(Number(day.minimumC))}° / ${Math.round(Number(day.maximumC))}°`);
    }
    if (hasNumericValue(day.precipitationProbabilityPercent)) {
      addText(card, "p", "weather-day-rain", `Rain chance ${Math.round(Number(day.precipitationProbabilityPercent))}%`);
    }
    weatherDays.appendChild(card);
  }

  const retrieved = data.retrievedAt ? formatLocalDate(data.retrievedAt, { dateStyle: "medium", timeStyle: "short" }) : "time not provided";
  const valid = formatLocalWeatherTime(data.validTime);
  weatherStatus.textContent = `Provider response retrieved ${retrieved} (South African time); model snapshot valid for ${valid}.`;
  const providerUrl = safeHttpsUrl(data.providerUrl);
  const providerLink = document.getElementById("weatherProvider");
  if (providerLink && providerUrl) providerLink.href = providerUrl;
}

async function loadWeather() {
  if (refreshWeatherButton) refreshWeatherButton.disabled = true;
  weatherStatus.textContent = "Loading the latest forecast model data…";
  try {
    const response = await fetch("/api/weather", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Forecast unavailable.");
    renderWeather(data);
  } catch {
    weatherCurrent.replaceChildren();
    weatherDays.replaceChildren();
    weatherStatus.textContent = "The forecast is unavailable right now. Please try again shortly.";
  } finally {
    if (refreshWeatherButton) refreshWeatherButton.disabled = false;
  }
}

function renderSources(data) {
  sourceRoot.replaceChildren();
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  if (!groups.length) {
    addText(sourceRoot, "p", "community-status", "Official source links are temporarily unavailable.");
    return;
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "community-source-group";
    addText(section, "h3", "", group.title || "Public information");
    if (group.description) addText(section, "p", "community-source-description", group.description);
    const list = document.createElement("ul");
    for (const source of Array.isArray(group.sources) ? group.sources.slice(0, 12) : []) {
      const url = safeHttpsUrl(source.url);
      if (!url || !source.title) continue;
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = String(source.title).slice(0, 160);
      item.appendChild(link);
      if (source.description) addText(item, "p", "community-source-description", source.description);
      list.appendChild(item);
    }
    if (list.childElementCount) section.appendChild(list);
    if (section.querySelector("li")) sourceRoot.appendChild(section);
  }

  if (!sourceRoot.childElementCount) addText(sourceRoot, "p", "community-status", "Official source links are temporarily unavailable.");
}

function renderPlaces(data) {
  if (!placesRoot) return;
  placesRoot.replaceChildren();
  const records = Array.isArray(data?.places) ? data.places : [];
  if (!records.length) {
    addText(placesRoot, "p", "community-status", "Sourced place records are temporarily unavailable.");
    return;
  }
  for (const record of records) {
    if (!record?.name || !record?.sourceUrl) continue;
    const card = document.createElement("article");
    card.className = "community-place-card";
    addText(card, "h3", "", record.name);
    if (record.category) addText(card, "p", "community-place-category", record.category);
    if (record.locality) addText(card, "p", "community-place-locality", record.locality);
    if (record.phone) {
      const phone = String(record.phone);
      const digits = phone.replace(/\D/g, "");
      if (digits.length >= 9 && digits.length <= 13) {
        const link = document.createElement("a");
        link.className = "community-place-phone";
        link.href = `tel:${phone.replace(/[^+\d]/g, "")}`;
        link.textContent = phone;
        card.appendChild(link);
      }
    }
    if (record.note) addText(card, "p", "community-place-note", record.note);
    const checkedAt = record.checkedAt ? formatLocalDate(record.checkedAt, { dateStyle: "medium" }) : "date not recorded";
    addText(card, "p", "community-place-checked", `Source checked ${checkedAt}.`);
    const url = safeHttpsUrl(record.sourceUrl);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Open ${String(record.sourceTitle || "source").slice(0, 140)}`;
      card.appendChild(link);
    }
    placesRoot.appendChild(card);
  }
  if (!placesRoot.childElementCount) addText(placesRoot, "p", "community-status", "Sourced place records are temporarily unavailable.");
}

async function loadSources() {
  try {
    const response = await fetch("/api/community/sources", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Source list unavailable.");
    renderSources(data);
    renderPlaces(data);
  } catch {
    sourceRoot.replaceChildren();
    placesRoot?.replaceChildren();
    addText(sourceRoot, "p", "community-status", "Official source links are unavailable right now. Please try again later.");
    if (placesRoot) addText(placesRoot, "p", "community-status", "Sourced place records are unavailable right now.");
  }
}

refreshWeatherButton?.addEventListener("click", loadWeather);
loadWeather();
loadSources();
