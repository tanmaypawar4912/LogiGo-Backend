
import { calculateFareEstimate } from "../services/fareService.js";
import {
  retrieveLocationSuggestion,
  suggestLocationAddresses,
} from "../services/mapboxService.js";
import { createSignedLocationToken } from "../utils/locationToken.js";

const CITY_IDS = new Set([
  "pune", "mumbai", "nashik", "nagpur", "delhi", "bengaluru",
  "chennai", "hyderabad", "ahmedabad", "jaipur", "kolkata", "surat",
  "indore", "lucknow", "coimbatore", "kochi", "chandigarh", "ludhiana",
  "bhopal", "vadodara", "patna", "bhubaneswar", "vizag", "mysuru",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAPBOX_ID_PATTERN = /^[A-Za-z0-9._:/+=_-]{1,256}$/;

function sendLocationError(res, error, fallback) {
  const statusCode = error.statusCode || 502;
  return res.status(statusCode).json({
    success: false,
    message: statusCode < 500 ? error.message : fallback,
  });
}

export const getLocationSuggestions = async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const sessionToken = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
  const city = typeof req.query.city === "string" ? req.query.city : "";

  if (query.length < 3 || query.length > 160) {
    return res.status(400).json({ success: false, message: "Enter at least 3 characters to search locations." });
  }
  if (!UUID_PATTERN.test(sessionToken)) {
    return res.status(400).json({ success: false, message: "A valid location search session is required. Try typing again." });
  }
  if (!CITY_IDS.has(city)) {
    return res.status(400).json({ success: false, message: "Choose a valid booking city." });
  }

  try {
    const suggestions = await suggestLocationAddresses({ query, sessionToken, city });
    return res.status(200).json({ success: true, suggestions });
  } catch (error) {
    console.error("Location suggestions error:", error.message);
    return sendLocationError(res, error, "Location suggestions are temporarily unavailable.");
  }
};

export const retrieveLocationDetails = async (req, res) => {
  const mapboxId = typeof req.query.mapboxId === "string" ? req.query.mapboxId : "";
  const sessionToken = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
  const city = typeof req.query.city === "string" ? req.query.city : "";

  if (!MAPBOX_ID_PATTERN.test(mapboxId)) {
    return res.status(400).json({ success: false, message: "Select a valid location suggestion." });
  }
  if (!UUID_PATTERN.test(sessionToken)) {
    return res.status(400).json({ success: false, message: "The location search session expired. Search again and select a result." });
  }
  if (!CITY_IDS.has(city)) {
    return res.status(400).json({ success: false, message: "Choose a valid booking city." });
  }

  try {
    const location = await retrieveLocationSuggestion({ mapboxId, sessionToken, city });
    const locationToken = createSignedLocationToken(location);
    return res.status(200).json({
      success: true,
      location: {
        address: location.address,
        featureType: location.featureType,
        locationToken,
      },
    });
  } catch (error) {
    console.error("Location retrieval error:", error.message);
    return sendLocationError(res, error, "The selected location could not be retrieved. Please choose it again.");
  }
};

export const estimateFare = async (req, res) => {
  try {
    const estimate = await calculateFareEstimate(req.body);

    return res.status(200).json({
      success: true,
      message: "Fare estimated successfully",
      ...estimate,
    });
  } catch (error) {
    console.error("Fare estimation error:", error.message);

    const statusCode = error.statusCode || 500;

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode < 500
          ? error.message
          : "Unable to estimate fare at this time.",
    });
  }
};
