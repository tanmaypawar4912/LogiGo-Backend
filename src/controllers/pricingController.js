
import { calculateFareEstimate } from "../services/fareService.js";

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
