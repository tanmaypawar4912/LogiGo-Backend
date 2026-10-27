import Vehicle from "../models/Vehicle.js";
import PricingRule from "../models/PricingRule.js";
import DriverProfile from "../models/DriverProfile.js";
import { profilesAreDispatchEligible } from "../services/dispatchService.js";

export const getVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({
      isActive: true,
    })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    const vehicleIds = vehicles.map((vehicle) => vehicle._id);

    const pricingRules = await PricingRule.find({
      vehicle: { $in: vehicleIds },
      isActive: true,
    })
      .select(
        "vehicle baseFare perKmRate perKgRate minimumFare serviceFee"
      )
      .lean();

    const pricingMap = new Map(
      pricingRules.map(({ vehicle, ...pricing }) => [
        vehicle.toString(),
        pricing,
      ])
    );

    const result = vehicles.map((vehicle) => ({
      ...vehicle,
      pricing: pricingMap.get(vehicle._id.toString()) ?? null,
    }));

    return res.status(200).json({
      success: true,
      count: result.length,
      vehicles: result,
    });
  } catch (error) {
    console.error("Get vehicles error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch vehicles",
    });
  }
};

/**
 * Public, read-only availability estimate. Counts only active, approved,
 * online driver profiles that match this vehicle category and load capacity
 * and pass the exact document/photo eligibility helper used by dispatch.
 * Driver location is not part of the current profile schema, so this is not
 * a route-distance guarantee. Dispatch re-checks eligibility before offering.
 */
export const getVehicleAvailability = async (req, res) => {
  try {
    const { vehicleId } = req.query;
    const weightKg = Number(req.query.weightKg);

    if (typeof vehicleId !== "string" || !/^[a-f\d]{24}$/i.test(vehicleId)) {
      return res.status(400).json({
        success: false,
        message: "A valid vehicle ID is required.",
      });
    }

    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 5000) {
      return res.status(400).json({
        success: false,
        message: "Weight must be between 0.1 and 5000 kg.",
      });
    }

    const vehicle = await Vehicle.findOne({
      _id: vehicleId,
      isActive: true,
    })
      .select("name slug capacityKg")
      .lean();

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found or unavailable.",
      });
    }

    if (weightKg > vehicle.capacityKg) {
      return res.status(422).json({
        success: false,
        message: `This vehicle supports up to ${vehicle.capacityKg} kg.`,
      });
    }

    const profiles = await DriverProfile.find({
      approvalStatus: "approved",
      availability: "online",
      isActive: true,
      licenseExpiry: { $gt: new Date() },
      vehicleType: vehicle.slug,
      vehicleCapacityKg: { $gte: weightKg },
    })
      .populate({ path: "user", select: "role isActive" })
      .sort({ updatedAt: 1 })
      .limit(200)
      .lean();

    const candidates = profiles.filter(
      (profile) =>
        profile.user &&
        profile.user.role === "driver" &&
        profile.user.isActive
    );

    const eligibility = await profilesAreDispatchEligible(candidates);
    const eligibleDriverCount = candidates.filter(
      (_profile, index) => eligibility[index]
    ).length;
    const available = eligibleDriverCount > 0;

    return res.status(200).json({
      success: true,
      vehicle: {
        id: String(vehicle._id),
        name: vehicle.name,
        slug: vehicle.slug,
        capacityKg: vehicle.capacityKg,
      },
      availability: {
        status: available ? "available" : "unavailable",
        eligibleDriverCount,
        checkedAt: new Date().toISOString(),
        routeSpecific: false,
        message: available
          ? "Eligible drivers are currently online for this vehicle category and load size. Availability may change before dispatch."
          : "No approved, online, document-eligible driver currently matches this vehicle category and load size. Retry, choose another vehicle, or place the booking to let automatic dispatch retry.",
      },
    });
  } catch (error) {
    console.error("Vehicle availability error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to check vehicle availability right now.",
    });
  }
};
