
import { env } from "../config/env.js";

const MAPBOX_GEOCODING_URL =
  "https://api.mapbox.com/search/geocode/v6/forward";

const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

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
