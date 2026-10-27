import express from "express";
import { getVehicles, getVehicleAvailability } from "../controllers/vehicleController.js";

const router = express.Router();

router.get("/availability", getVehicleAvailability);
router.get("/", getVehicles);

export default router;