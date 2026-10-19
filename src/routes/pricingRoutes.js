
import express from "express";

import { estimateFare } from "../controllers/pricingController.js";
import { validate } from "../middleware/validateMiddleware.js";
import { estimateFareSchema } from "../validators/pricingValidator.js";

const router = express.Router();

router.post(
  "/estimate",
  validate(estimateFareSchema),
  estimateFare
);

export default router;
