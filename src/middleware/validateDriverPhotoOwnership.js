
import DriverMediaAsset from "../models/DriverMediaAsset.js";

const PHOTO_VIEWS = ["front", "right", "left", "back"];

export async function validateDriverPhotoOwnership(req, res, next) {
  try {
    const photos = req.body?.photos;
    const ownerId = req.user?.userId || req.user?._id;

    if (!ownerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
      });
    }

    if (!photos || typeof photos !== "object") {
      return res.status(422).json({
        success: false,
        message: "All four vehicle photos are required",
      });
    }

    for (const view of PHOTO_VIEWS) {
      const url = photos[view];

      if (typeof url !== "string" || !url.trim()) {
        return res.status(422).json({
          success: false,
          message: `The ${view} vehicle photo is required`,
        });
      }

      let parsedUrl;

      try {
        parsedUrl = new URL(url);
      } catch {
        return res.status(422).json({
          success: false,
          message: `The ${view} vehicle photo URL is invalid`,
        });
      }

      if (
        parsedUrl.protocol !== "https:" ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        return res.status(422).json({
          success: false,
          message: `The ${view} vehicle photo must use HTTPS`,
        });
      }

      const asset = await DriverMediaAsset.findOne({
        owner: ownerId,
        kind: "vehicle-photo",
        view,
        secureUrl: url,
        status: { $in: ["uploaded", "linked"] },
      })
        .select("_id")
        .lean();

      if (!asset) {
        return res.status(422).json({
          success: false,
          message:
            `The ${view} vehicle photo is not a valid uploaded photo belonging to your account. Upload it again.`,
        });
      }
    }

    return next();
  } catch (error) {
    console.error("Validate driver photo ownership:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify vehicle photo ownership",
    });
  }
}
