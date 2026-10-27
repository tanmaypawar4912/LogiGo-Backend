
import express from "express";

import {
  estimateFare,
  getLocationSuggestions,
  retrieveLocationDetails,
} from "../controllers/pricingController.js";
import { validate } from "../middleware/validateMiddleware.js";
import { estimateFareSchema } from "../validators/pricingValidator.js";

const router = express.Router();

router.get("/locations/suggest", getLocationSuggestions);
router.get("/locations/retrieve", retrieveLocationDetails);

router.post(
  "/estimate",
  validate(estimateFareSchema),
  estimateFare
);

export default router;
