
import { env } from "../config/env.js";

const MAPBOX_GEOCODING_URL =
  "https://api.mapbox.com/search/geocode/v6/forward";

const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";
const MAPBOX_SEARCHBOX_URL =
  "https://api.mapbox.com/search/searchbox/v1";

const CITY_PROXIMITY = {
  pune: [73.8567, 18.5204],
  mumbai: [72.8777, 19.076],
  nashik: [73.7898, 19.9975],
  nagpur: [79.0882, 21.1458],
  delhi: [77.209, 28.6139],
  bengaluru: [77.5946, 12.9716],
  chennai: [80.2707, 13.0827],
  hyderabad: [78.4867, 17.385],
  ahmedabad: [72.5714, 23.0225],
  jaipur: [75.7873, 26.9124],
  kolkata: [88.3639, 22.5726],
  surat: [72.8311, 21.1702],
  indore: [75.8577, 22.7196],
  lucknow: [80.9462, 26.8467],
  coimbatore: [76.9558, 11.0168],
  kochi: [76.2673, 9.9312],
  chandigarh: [76.7794, 30.7333],
  ludhiana: [75.8573, 30.901],
  bhopal: [77.4126, 23.2599],
  vadodara: [73.1812, 22.3072],
  patna: [85.1376, 25.5941],
  bhubaneswar: [85.8245, 20.2961],
  vizag: [83.2185, 17.6868],
  mysuru: [76.6394, 12.2958],
};

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readMapboxResponse(response) {
  let data;

  try {
    data = await response.json();
  } catch {
    throw createError(
      "Mapbox returned an invalid response.",
      502
    );
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw createError(
        "Mapbox request limit reached. Please try again later.",
        503
      );
    }

    console.error("Mapbox API error:", {
      status: response.status,
      message: data.message || data.error || "Unknown error",
    });

    throw createError(
      "Location service is temporarily unavailable. Please try again.",
      502
    );
  }

  return data;
}

export async function geocodeAddress(address) {
  const params = new URLSearchParams({
    q: address,
    country: "IN",
    limit: "1",
    autocomplete: "false",
    access_token: env.MAPBOX_ACCESS_TOKEN,
  });

  let response;

  try {
    response = await fetch(
      `${MAPBOX_GEOCODING_URL}?${params}`,
      { signal: AbortSignal.timeout(10000) }
    );
  } catch {
    throw createError(
      "Could not contact the location service.",
      502
    );
  }

  const data = await readMapboxResponse(response);
  const feature = data.features?.[0];

  if (!feature?.geometry?.coordinates) {
    throw createError(
      `Could not find the address: ${address}`,
      422
    );
  }

  const [longitude, latitude] = feature.geometry.coordinates;

  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude)
  ) {
    throw createError(
      "Location service returned invalid coordinates.",
      502
    );
  }

  return {
    longitude,
    latitude,
    resolvedAddress:
      feature.properties?.full_address ||
      feature.properties?.name ||
      address,
  };
}

export async function getDrivingRoute(pickup, drop) {
  const coordinates = [
    `${pickup.longitude},${pickup.latitude}`,
    `${drop.longitude},${drop.latitude}`,
  ].join(";");

  const url =
    `${MAPBOX_DIRECTIONS_URL}/${coordinates}`;

  const params = new URLSearchParams({
    access_token: env.MAPBOX_ACCESS_TOKEN,
    overview: "false",
    steps: "false",
    alternatives: "false",
  });

  let response;

  try {
    response = await fetch(`${url}?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw createError(
      "Could not calculate the driving route.",
      502
    );
  }

  const data = await readMapboxResponse(response);
  const route = data.routes?.[0];

  if (
    data.code !== "Ok" ||
    !route ||
    !Number.isFinite(route.distance) ||
    !Number.isFinite(route.duration)
  ) {
    throw createError(
      "No drivable route was found between these locations.",
      422
    );
  }

  if (route.distance <= 0) {
    throw createError(
      "Please select two different delivery locations.",
      422
    );
  }

  return {
    distanceMeters: route.distance,
    distanceKm: Math.round((route.distance / 1000) * 100) / 100,
    durationSeconds: route.duration,
    durationMinutes: Math.ceil(route.duration / 60),
  };
}


/**
 * Fetches interactive address/POI suggestions. Search Box results are returned
 * only to the current UI request; this service does not cache them in MongoDB.
 */
export async function suggestLocationAddresses({ query, sessionToken, city }) {
  const params = new URLSearchParams({
    q: query,
    session_token: sessionToken,
    access_token: env.MAPBOX_ACCESS_TOKEN,
    country: "IN",
    language: "en",
    limit: "6",
  });

  const proximity = CITY_PROXIMITY[city];
  if (proximity) {
    params.set("proximity", `${proximity[0]},${proximity[1]}`);
  }

  let response;
  try {
    response = await fetch(`${MAPBOX_SEARCHBOX_URL}/suggest?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw createError("Could not contact the location search service.", 502);
  }

  const data = await readMapboxResponse(response);
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

  return suggestions
    .filter((item) => item && typeof item.mapbox_id === "string")
    .map((item) => ({
      id: item.mapbox_id,
      name: item.name_preferred || item.name || item.full_address || "Location",
      fullAddress:
        item.full_address ||
        [item.name_preferred || item.name, item.place_formatted].filter(Boolean).join(", "),
      placeFormatted: item.place_formatted || "",
      featureType: item.feature_type || "place",
      category: Array.isArray(item.poi_category) ? item.poi_category.slice(0, 2).join(" · ") : "",
    }));
}

/** Completes a Search Box suggestion session after a user selects a result. */
export async function retrieveLocationSuggestion({ mapboxId, sessionToken, city }) {
  const params = new URLSearchParams({
    session_token: sessionToken,
    access_token: env.MAPBOX_ACCESS_TOKEN,
    language: "en",
  });

  const proximity = CITY_PROXIMITY[city];
  if (proximity) {
    params.set("proximity", `${proximity[0]},${proximity[1]}`);
  }

  let response;
  try {
    response = await fetch(
      `${MAPBOX_SEARCHBOX_URL}/retrieve/${encodeURIComponent(mapboxId)}?${params}`,
      { signal: AbortSignal.timeout(10000) }
    );
  } catch {
    throw createError("Could not retrieve the selected location.", 502);
  }

  const data = await readMapboxResponse(response);
  const feature = data.features?.[0];
  const properties = feature?.properties;
  const address =
    properties?.full_address ||
    [properties?.name, properties?.place_formatted].filter(Boolean).join(", ");

  if (!address) {
    throw createError("The selected location could not be resolved. Choose another suggestion.", 422);
  }

  const coordinates = feature?.geometry?.coordinates;
  const longitude = Array.isArray(coordinates) ? coordinates[0] : NaN;
  const latitude = Array.isArray(coordinates) ? coordinates[1] : NaN;

  if (
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90
  ) {
    throw createError("The selected location did not return valid coordinates. Choose another suggestion.", 422);
  }

  return {
    address,
    longitude,
    latitude,
    featureType: properties?.feature_type || "place",
  };
}
