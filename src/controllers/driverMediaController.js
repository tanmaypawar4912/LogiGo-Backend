import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import DriverMediaAsset from "../models/DriverMediaAsset.js";
import DriverProfile from "../models/DriverProfile.js";
import DriverActivity from "../models/DriverActivity.js";

const MAX_FILE_SIZE = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MEDIA_KINDS = new Set([
  "vehicle-photo",
  "license-document",
  "identity-document",
  "vehicle-document",
]);

const VEHICLE_PHOTO_VIEWS = new Set([
  "front",
  "right",
  "left",
  "back",
]);

function respondError(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
  });
}

function getOwnerId(req) {
  return req.user?.userId || req.user?._id || null;
}

function isDocumentKind(kind) {
  return [
    "license-document",
    "identity-document",
    "vehicle-document",
  ].includes(kind);
}

function getFolder(kind, ownerId) {
  if (kind === "vehicle-photo") {
    return `logigo/drivers/${ownerId}/vehicle-photos`;
  }

  return `logigo/private-drivers/${ownerId}/${kind}`;
}

async function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) return reject(error);

        if (!result) {
          return reject(new Error("Cloudinary returned no upload result"));
        }

        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

async function recordActivity({
  driver,
  driverProfile = null,
  action,
  message,
  metadata = {},
}) {
  try {
    await DriverActivity.create({
      driver,
      driverProfile,
      actor: driver,
      action,
      message,
      metadata,
    });
  } catch (error) {
    console.error("Driver media activity log failed:", error.message);
  }
}

async function findOwnedAsset(assetId, ownerId) {
  if (!mongoose.isValidObjectId(assetId)) return null;

  return DriverMediaAsset.findOne({
    _id: assetId,
    owner: ownerId,
    status: { $in: ["uploaded", "linked"] },
  });
}

function getPrivateDocumentUrl(asset) {
  if (!asset?.publicId || !asset?.format) return null;

  return cloudinary.utils.private_download_url(
    asset.publicId,
    asset.format,
    {
      resource_type: asset.resourceType || "image",
      type: asset.deliveryType || "authenticated",
      attachment: false,
      expires_at: Math.floor(Date.now() / 1000) + 120,
    }
  );
}

/**
 * POST /api/drivers/media/upload
 *
 * multipart/form-data:
 * - file: image file
 * - kind: vehicle-photo | license-document |
 *         identity-document | vehicle-document
 * - view: front | right | left | back (vehicle photos only)
 */
export const uploadDriverMedia = async (req, res) => {
  let cloudinaryResult = null;

  try {
    const ownerId = getOwnerId(req);

    if (!ownerId) {
      return respondError(res, 401, "Authentication is required");
    }

    if (!req.file?.buffer) {
      return respondError(res, 400, "Select an image to upload");
    }

    const { kind, view } = req.body;

    if (!MEDIA_KINDS.has(kind)) {
      return respondError(res, 422, "Invalid media type");
    }

    if (!ALLOWED_IMAGE_TYPES.has(req.file.mimetype)) {
      return respondError(
        res,
        422,
        "Only JPG, PNG and WEBP images are allowed"
      );
    }

    if (req.file.size > MAX_FILE_SIZE) {
      return respondError(
        res,
        413,
        "Image size must be 8 MB or less"
      );
    }

    if (
      kind === "vehicle-photo" &&
      !VEHICLE_PHOTO_VIEWS.has(view)
    ) {
      return respondError(
        res,
        422,
        "Vehicle photos require a valid view: front, right, left or back"
      );
    }

    if (kind !== "vehicle-photo" && view) {
      return respondError(
        res,
        422,
        "The view field is only allowed for vehicle photos"
      );
    }

    const profile = await DriverProfile.findOne({ user: ownerId })
      .select("_id")
      .lean();

    const deliveryType = isDocumentKind(kind)
      ? "authenticated"
      : "upload";

    cloudinaryResult = await uploadBufferToCloudinary(
      req.file.buffer,
      {
        folder: getFolder(kind, ownerId),
        resource_type: "image",
        type: deliveryType,
        use_filename: false,
        unique_filename: true,
        overwrite: false,
        format: "jpg",
        transformation: [
          {
            width: 2400,
            height: 2400,
            crop: "limit",
            quality: "auto:good",
          },
        ],
        context: {
          application: "logigo",
          ownerId: String(ownerId),
          kind,
          ...(view ? { view } : {}),
        },
      }
    );

    const asset = await DriverMediaAsset.create({
      owner: ownerId,
      driverProfile: profile?._id || null,
      kind,
      view: kind === "vehicle-photo" ? view : null,
      cloudinaryAssetId: cloudinaryResult.asset_id,
      publicId: cloudinaryResult.public_id,
      resourceType: cloudinaryResult.resource_type || "image",
      deliveryType,
      secureUrl: cloudinaryResult.secure_url,
      format: cloudinaryResult.format,
      bytes: cloudinaryResult.bytes,
      width: cloudinaryResult.width,
      height: cloudinaryResult.height,
      originalFilename: req.file.originalname,
      status: "uploaded",
    });

    await recordActivity({
      driver: ownerId,
      driverProfile: profile?._id || null,
      action: "driver_media_uploaded",
      message: "Driver uploaded a media asset",
      metadata: {
        assetId: String(asset._id),
        kind,
        view: asset.view,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Image uploaded successfully",
      asset: {
        id: String(asset._id),
        kind: asset.kind,
        view: asset.view,
        status: asset.status,
        resourceType: asset.resourceType,
        deliveryType: asset.deliveryType,
        format: asset.format,
        bytes: asset.bytes,
        width: asset.width,
        height: asset.height,

        // Public URL is returned only for vehicle photos.
        // Private document URLs must not be exposed here.
        url: kind === "vehicle-photo" ? asset.secureUrl : null,

        // Frontend uses this ID in its profile/vehicle payload.
        assetId: String(asset._id),
      },
    });
  } catch (error) {
    if (cloudinaryResult?.public_id) {
      try {
        await cloudinary.uploader.destroy(
          cloudinaryResult.public_id,
          {
            resource_type: "image",
            type: cloudinaryResult.type || "upload",
            invalidate: true,
          }
        );
      } catch (cleanupError) {
        console.error(
          "Cloudinary cleanup failed:",
          cleanupError.message
        );
      }
    }

    if (error.code === 11000) {
      return respondError(
        res,
        409,
        "This media asset is already registered"
      );
    }

    console.error("Upload driver media:", error.message);

    return respondError(res, 500, "Unable to upload image");
  }
};

/**
 * GET /api/drivers/media/:assetId/access
 *
 * Driver can access their own media.
 * Admin can access driver documents for review.
 */
export const getDriverMediaAccess = async (req, res) => {
  try {
    const ownerId = getOwnerId(req);

    if (!ownerId) {
      return respondError(res, 401, "Authentication is required");
    }

    if (!mongoose.isValidObjectId(req.params.assetId)) {
      return respondError(res, 400, "Invalid media asset ID");
    }

    const asset = await DriverMediaAsset.findOne({
      _id: req.params.assetId,
      status: { $in: ["uploaded", "linked"] },
    });

    if (!asset) {
      return respondError(res, 404, "Media asset not found");
    }

    const isOwner = String(asset.owner) === String(ownerId);
    const isAdmin = req.user?.role === "admin";

    if (!isOwner && !isAdmin) {
      return respondError(
        res,
        403,
        "You are not allowed to access this media"
      );
    }

    if (asset.kind === "vehicle-photo") {
      if (!asset.secureUrl) {
        return respondError(res, 404, "Vehicle photo is unavailable");
      }

      return res.status(200).json({
        success: true,
        assetId: String(asset._id),
        kind: asset.kind,
        view: asset.view,
        url: asset.secureUrl,
        expiresAt: null,
      });
    }

    const url = getPrivateDocumentUrl(asset);

    if (!url) {
      return respondError(
        res,
        500,
        "Unable to create a secure document link"
      );
    }

    return res.status(200).json({
      success: true,
      assetId: String(asset._id),
      kind: asset.kind,
      url,
      expiresAt: new Date(Date.now() + 120000).toISOString(),
    });
  } catch (error) {
    console.error("Get driver media access:", error.message);

    return respondError(
      res,
      500,
      "Unable to create a secure media access link"
    );
  }
};

/**
 * DELETE /api/drivers/media/:assetId
 *
 * Only an unlinked vehicle-photo asset can be deleted.
 * Linked photos and all document assets are protected.
 */
export const deleteDriverMediaAsset = async (req, res) => {
  try {
    const ownerId = getOwnerId(req);

    if (!ownerId) {
      return respondError(res, 401, "Authentication is required");
    }

    if (!mongoose.isValidObjectId(req.params.assetId)) {
      return respondError(res, 400, "Invalid media asset ID");
    }

    const asset = await DriverMediaAsset.findOne({
      _id: req.params.assetId,
      owner: ownerId,
    });

    if (!asset || asset.status === "deleted") {
      return respondError(res, 404, "Media asset not found");
    }

    if (asset.kind !== "vehicle-photo") {
      return respondError(
        res,
        403,
        "Licence, identity and vehicle registration documents cannot be deleted through this endpoint"
      );
    }

    if (asset.status !== "uploaded" || asset.driverProfile) {
      return respondError(
        res,
        409,
        "This photo is linked to a driver profile or vehicle and cannot be deleted"
      );
    }

    // Profile/request saves and media linking are separate operations. Check
    // live references as a second safety barrier so a just-submitted photo
    // cannot be deleted before its asset record is marked linked.
    const profile = await DriverProfile.findOne({ user: ownerId })
      .select("vehiclePhotos registeredVehicles")
      .lean();

    if (profile) {
      const activePhotoUrls = new Set();
      const addPhotos = (photos) => {
        for (const view of ["front", "right", "left", "back"]) {
          const url = photos?.[view];
          if (typeof url === "string" && url) activePhotoUrls.add(url);
        }
      };

      addPhotos(profile.vehiclePhotos);
      for (const vehicle of profile.registeredVehicles || []) {
        addPhotos(vehicle.photos);
        if (vehicle.changeRequest?.status === "pending") {
          addPhotos(vehicle.changeRequest.photos);
        }
      }

      if (activePhotoUrls.has(asset.secureUrl)) {
        return respondError(
          res,
          409,
          "This photo is referenced by a registered vehicle or pending change request and cannot be deleted"
        );
      }
    }

    const destroyResult = await cloudinary.uploader.destroy(
      asset.publicId,
      {
        resource_type: asset.resourceType || "image",
        type: asset.deliveryType || "upload",
        invalidate: true,
      }
    );

    if (
      destroyResult.result !== "ok" &&
      destroyResult.result !== "not found"
    ) {
      return respondError(
        res,
        502,
        "Cloudinary could not delete this image"
      );
    }

    asset.status = "deleted";
    await asset.save();

    await recordActivity({
      driver: ownerId,
      driverProfile: asset.driverProfile || null,
      action: "driver_media_deleted",
      message: "Driver deleted an unlinked vehicle photo",
      metadata: {
        assetId: String(asset._id),
        kind: asset.kind,
        view: asset.view,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle photo deleted successfully",
      assetId: String(asset._id),
    });
  } catch (error) {
    console.error("Delete driver media:", error.message);

    return respondError(res, 500, "Unable to delete this image");
  }
};