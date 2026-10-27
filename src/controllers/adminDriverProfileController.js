import DriverProfile from "../models/DriverProfile.js";
import DriverMediaAsset from "../models/DriverMediaAsset.js";
import cloudinary from "../config/cloudinary.js";

const publicDriverFields = "name email phone role";

const DOCUMENT_KINDS = {
  licenseDocumentAssetId: "license-document",
  identityDocumentAssetId: "identity-document",
  vehicleDocumentAssetId: "vehicle-document",
};

function idString(value) {
  if (!value) return "";
  return String(value._id ?? value);
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function getPrivateDocumentUrl(asset) {
  if (!asset?.publicId || !asset?.format) {
    return null;
  }

  return cloudinary.utils.private_download_url(
    asset.publicId,
    asset.format,
    {
      resource_type: asset.resourceType || "image",
      type: asset.deliveryType || "authenticated",
      attachment: false,

      // Admin document preview link expires after 15 minutes.
      expires_at: Math.floor(Date.now() / 1000) + 15 * 60,
    }
  );
}

function primaryVehicleOf(profile) {
  const vehicles = Array.isArray(profile.registeredVehicles)
    ? profile.registeredVehicles
    : [];

  return (
    vehicles.find((vehicle) => vehicle.isPrimary) ||
    vehicles[0] ||
    null
  );
}

async function addAdminDocumentLinks(profiles) {
  const assetIds = new Set();

  for (const profile of profiles) {
    const documents = profile.documents || {};
    const primaryVehicle = primaryVehicleOf(profile);

    for (const field of Object.keys(DOCUMENT_KINDS)) {
      if (documents[field]) {
        assetIds.add(idString(documents[field]));
      }
    }

    // Older profiles may have the vehicle document asset linked only
    // on the primary registered vehicle.
    if (primaryVehicle?.vehicleDocumentAssetId) {
      assetIds.add(
        idString(primaryVehicle.vehicleDocumentAssetId)
      );
    }
  }

  const validIds = [...assetIds].filter((value) =>
    /^[a-f\d]{24}$/i.test(value)
  );

  const mediaAssets = validIds.length
    ? await DriverMediaAsset.find({
        _id: { $in: validIds },
        status: { $in: ["uploaded", "linked"] },
      }).lean()
    : [];

  const assetById = new Map(
    mediaAssets.map((asset) => [
      idString(asset._id),
      asset,
    ])
  );

  const enrichedProfiles = await Promise.all(
    profiles.map(async (profile) => {
      const originalDocuments = profile.documents || {};
      const primaryVehicle = primaryVehicleOf(profile);
      const ownerId = idString(profile.user);

      async function resolveDocument({
        assetId,
        kind,
        legacyUrl,
      }) {
        // Continue supporting older profiles that stored HTTPS document
        // URLs instead of private media asset IDs.
        if (isHttpsUrl(legacyUrl)) {
          return legacyUrl;
        }

        if (!assetId) {
          return null;
        }

        const asset = assetById.get(idString(assetId));

        if (
          !asset ||
          idString(asset.owner) !== ownerId ||
          asset.kind !== kind
        ) {
          return null;
        }

        try {
          return getPrivateDocumentUrl(asset);
        } catch (error) {
          console.error(
            `Unable to sign ${kind} for admin review:`,
            error.message
          );

          return null;
        }
      }

      const [
        licenseDocumentUrl,
        identityDocumentUrl,
        vehicleDocumentUrl,
      ] = await Promise.all([
        resolveDocument({
          assetId: originalDocuments.licenseDocumentAssetId,
          kind: DOCUMENT_KINDS.licenseDocumentAssetId,
          legacyUrl: originalDocuments.licenseDocumentUrl,
        }),

        resolveDocument({
          assetId: originalDocuments.identityDocumentAssetId,
          kind: DOCUMENT_KINDS.identityDocumentAssetId,
          legacyUrl: originalDocuments.identityDocumentUrl,
        }),

        resolveDocument({
          assetId:
            originalDocuments.vehicleDocumentAssetId ||
            primaryVehicle?.vehicleDocumentAssetId,
          kind: DOCUMENT_KINDS.vehicleDocumentAssetId,
          legacyUrl:
            originalDocuments.vehicleDocumentUrl ||
            primaryVehicle?.vehicleDocumentUrl,
        }),
      ]);

      return {
        ...profile,

        // These are response-only URLs. The original database document
        // references are not overwritten by this listing operation.
        documents: {
          ...originalDocuments,
          licenseDocumentUrl,
          identityDocumentUrl,
          vehicleDocumentUrl,
        },
      };
    })
  );

  return enrichedProfiles;
}

// ADMIN: List/filter driver profiles and create short-lived document
// links for uploaded private assets.
export const listDriverProfilesForAdmin = async (req, res) => {
  try {
    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const allowedStatuses = [
      "pending",
      "approved",
      "rejected",
      "suspended",
    ];

    const approvalStatus =
      typeof req.query.approvalStatus === "string"
        ? req.query.approvalStatus
        : "";

    if (
      approvalStatus &&
      !allowedStatuses.includes(approvalStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid driver approval status filter",
      });
    }

    const filter = approvalStatus
      ? { approvalStatus }
      : {};

    const [profiles, total] = await Promise.all([
      DriverProfile.find(filter)
        .populate("user", publicDriverFields)
        .populate("approvedBy", "name email")
        .populate("profileChangeRequest.reviewedBy", "name email")
        .populate("registeredVehicles.approvedBy", "name email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      DriverProfile.countDocuments(filter),
    ]);

    const drivers = await addAdminDocumentLinks(profiles);

    return res.status(200).json({
      success: true,
      drivers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(
      "List driver profiles for admin:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to list driver profiles",
    });
  }
};