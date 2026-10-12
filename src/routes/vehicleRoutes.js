import express from "express";
import { getVehicles } from "../controllers/vehicleController.js";

const router = express.Router();

router.get("/", getVehicles);

export default router;