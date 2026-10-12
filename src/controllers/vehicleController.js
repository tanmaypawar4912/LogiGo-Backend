import Vehicle from "../models/Vehicle.js";
import PricingRule from "../models/PricingRule.js";

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