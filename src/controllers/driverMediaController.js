import mongoose from "mongoose";

import cloudinary from "../config/cloudinary.js";
import DriverMediaAsset from "../models/DriverMediaAsset.js";
import DriverActivity from "../models/DriverActivity.js";

const validKinds = new Set([
  "vehicle-photo",
  "license-document",
  "identity-document",
  "vehicle-document",
]);

const validPhotoViews = new Set([
  "front",
  "right",
  "left",
  "back",
]);

function identifyFile(buffer) {
  if (!buffer || buffer.length < 4) return null;

  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }

  return null;
}

function uploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) return reject(error);

        if (!result) {
          return reject(
            new Error("Cloudinary returned no upload result")
          );
        }

        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

async function createActivity({
  driver,
  kind,
  view,
  assetId,
}) {
  try {
    await DriverActivity.create({
      driver,
      actor: driver,
      action: "media_uploaded",
      message: `Driver uploaded ${kind}${
        view ? ` (${view} view)` : ""
      }`,
      metadata: {
        assetId: String(assetId),
        kind,
        view: view || null,
      },
    });
  } catch (error) {
    console.error(
      "Driver media activity log failed:",
      error.message
    );
  }
}

export async function uploadDriverMediaAsset(req, res) {
  let cloudResult = null;
  let uploadOptions = null;

  try {
    const kind = String(req.query.kind || "");
    const view = req.query.view
      ? String(req.query.view)
      : null;

    if (!validKinds.has(kind)) {
      return res.status(400).json({
        success: false,
        message: "Invalid upload kind.",
      });
    }

    if (
      kind === "vehicle-photo" &&
      !validPhotoViews.has(view)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Vehicle photos require view=front, right, left or back.",
      });
    }

    if (kind !== "vehicle-photo" && view) {
      return res.status(400).json({
        success: false,
        message:
          "The view parameter is only for vehicle photos.",
      });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "Choose a file before uploading.",
      });
    }

    const detectedMime = identifyFile(req.file.buffer);

    if (
      !detectedMime ||
      detectedMime !== req.file.mimetype
    ) {
      return res.status(415).json({
        success: false,
        message:
          "File contents do not match an allowed JPG, PNG, WEBP or PDF file.",
      });
    }

    const isPhoto = kind === "vehicle-photo";

    if (isPhoto && !detectedMime.startsWith("image/")) {
      return res.status(415).json({
        success: false,
        message: "Vehicle photos must be JPG, PNG or WEBP.",
      });
    }

    const resourceType =
      detectedMime === "application/pdf" ? "raw" : "image";

    // Public delivery for vehicle photos.
    // Authenticated delivery for sensitive documents.
    const deliveryType = isPhoto
      ? "upload"
      : "authenticated";

    const folder = isPhoto
      ? `logigo/vehicle-photos/${req.user.userId}`
      : `logigo/driver-documents/${req.user.userId}`;

    uploadOptions = {
      folder,
      resource_type: resourceType,
      type: deliveryType,
      overwrite: false,
      use_filename: false,
      unique_filename: true,
      tags: ["logigo", `kind:${kind}`],

      ...(isPhoto
        ? {
            transformation: [
              {
                width: 2000,
                height: 2000,
                crop: "limit",
              },
              {
                quality: "auto:good",
                fetch_format: "auto",
              },
            ],
          }
        : {}),
    };

    cloudResult = await uploadToCloudinary(
      req.file.buffer,
      uploadOptions
    );

    // Persist the Cloudinary asset metadata in MongoDB.
    const asset = await DriverMediaAsset.create({
      owner: req.user.userId,
      kind,
      view,
      cloudinaryAssetId: cloudResult.asset_id,
      publicId: cloudResult.public_id,
      resourceType,
      deliveryType,
      secureUrl: cloudResult.secure_url,
      format:
        cloudResult.format ||
        (detectedMime === "application/pdf" ? "pdf" : "unknown"),
      bytes: cloudResult.bytes,
      width: cloudResult.width || null,
      height: cloudResult.height || null,
      originalFilename: String(
        req.file.originalname || ""
      ).slice(0, 200),
      status: "uploaded",
    });

    await createActivity({
      driver: req.user.userId,
      kind,
      view,
      assetId: asset._id,
    });

    return res.status(201).json({
      success: true,
      message:
        "File uploaded and asset metadata saved to MongoDB.",
      asset: {
        id: asset._id,
        kind: asset.kind,
        view: asset.view,
        deliveryType: asset.deliveryType,
        resourceType: asset.resourceType,
        format: asset.format,
        bytes: asset.bytes,
        width: asset.width,
        height: asset.height,

        // Only vehicle-photo URLs are sent directly to the frontend.
        url: isPhoto ? asset.secureUrl : null,

        // Private files must be opened through the protected endpoint.
        accessPath: isPhoto
          ? null
          : `/api/drivers/media/${asset._id}/access`,
      },
    });
  } catch (error) {
    // Clean up the Cloudinary object if saving metadata fails.
    if (cloudResult?.public_id && uploadOptions) {
      try {
        await cloudinary.uploader.destroy(
          cloudResult.public_id,
          {
            resource_type: uploadOptions.resource_type,
            type: uploadOptions.type,
          }
        );
      } catch (cleanupError) {
        console.error(
          "Cloudinary cleanup failed:",
          cleanupError.message
        );
      }
    }

    console.error("Driver media upload error:", error.message);

    return res.status(500).json({
      success: false,
      message:
        "Unable to upload the file. Check Cloudinary configuration and try again.",
    });
  }
}

export async function getDriverMediaAccess(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.assetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid media asset ID.",
      });
    }

    const asset = await DriverMediaAsset.findById(
      req.params.assetId
    ).lean();

    if (!asset || asset.status === "deleted") {
      return res.status(404).json({
        success: false,
        message: "File not found.",
      });
    }

    const isOwner =
      String(asset.owner) === String(req.user.userId);

    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(404).json({
        success: false,
        message: "File not found.",
      });
    }

    if (asset.deliveryType === "upload") {
      return res.redirect(302, asset.secureUrl);
    }

    // The signed link expires after two minutes.
    const expiresAt =
      Math.floor(Date.now() / 1000) + 120;

    const signedUrl =
      cloudinary.utils.private_download_url(
        asset.publicId,
        asset.format,
        {
          resource_type: asset.resourceType,
          type: asset.deliveryType,
          expires_at: expiresAt,
        }
      );

    res.setHeader("Cache-Control", "private, no-store");

    return res.redirect(302, signedUrl);
  } catch (error) {
    console.error("Driver media access error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to access this file.",
    });
  }
}