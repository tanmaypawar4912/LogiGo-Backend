import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";

let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
let apiKey = process.env.CLOUDINARY_API_KEY;
let apiSecret = process.env.CLOUDINARY_API_SECRET;

// Support the single CLOUDINARY_URL format too.
if ((!cloudName || !apiKey || !apiSecret) && process.env.CLOUDINARY_URL) {
  try {
    const parsedUrl = new URL(process.env.CLOUDINARY_URL);

    if (parsedUrl.protocol !== "cloudinary:") {
      throw new Error("Invalid Cloudinary URL protocol");
    }

    apiKey = apiKey || decodeURIComponent(parsedUrl.username);
    apiSecret = apiSecret || decodeURIComponent(parsedUrl.password);
    cloudName = cloudName || parsedUrl.hostname;
  } catch {
    throw new Error(
      "Invalid CLOUDINARY_URL format. Check the value in backend/.env"
    );
  }
}

if (!cloudName || !apiKey || !apiSecret) {
  throw new Error(
    "Cloudinary configuration missing. Check variable names in backend/.env"
  );
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

export default cloudinary;