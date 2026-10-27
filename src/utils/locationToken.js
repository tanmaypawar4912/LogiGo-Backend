import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_VERSION = 1;

function createError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sign(encodedPayload) {
  return createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(encodedPayload)
    .digest("base64url");
}

/** Creates a short-lived, tamper-resistant token for a user-selected Mapbox point. */
export function createSignedLocationToken({ address, longitude, latitude }) {
  if (
    typeof address !== "string" ||
    !address.trim() ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 || longitude > 180 ||
    latitude < -90 || latitude > 90
  ) {
    throw createError("The selected location details are invalid.", 422);
  }

  const payload = Buffer.from(JSON.stringify({
    version: TOKEN_VERSION,
    address: address.trim(),
    longitude,
    latitude,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  })).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

/** Verifies signature, expiry, and exact address binding before using client-carried coordinates. */
export function verifySignedLocationToken(token, expectedAddress) {
  if (typeof token !== "string" || token.length > 4096) {
    throw createError("Choose a location suggestion again before estimating the fare.", 422);
  }

  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    throw createError("The selected location could not be verified. Choose it again.", 422);
  }

  const payloadPart = token.slice(0, separator);
  const signaturePart = token.slice(separator + 1);
  const expectedSignature = Buffer.from(sign(payloadPart), "base64url");
  let providedSignature;

  try {
    providedSignature = Buffer.from(signaturePart, "base64url");
  } catch {
    throw createError("The selected location could not be verified. Choose it again.", 422);
  }

  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw createError("The selected location could not be verified. Choose it again.", 422);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    throw createError("The selected location could not be verified. Choose it again.", 422);
  }

  if (
    payload?.version !== TOKEN_VERSION ||
    typeof payload.address !== "string" ||
    !Number.isFinite(payload.longitude) ||
    !Number.isFinite(payload.latitude) ||
    !Number.isFinite(payload.expiresAt)
  ) {
    throw createError("The selected location details are invalid. Choose it again.", 422);
  }

  if (payload.expiresAt <= Date.now()) {
    throw createError("This location selection expired. Choose the pickup or drop-off suggestion again.", 422);
  }

  if (payload.address.trim() !== String(expectedAddress || "").trim()) {
    throw createError("The selected location does not match the address field. Choose the suggestion again.", 422);
  }

  return {
    resolvedAddress: payload.address,
    longitude: payload.longitude,
    latitude: payload.latitude,
  };
}
