import Booking from "../models/Booking.js";
import DriverProfile from "../models/DriverProfile.js";

const ACTIVE_DRIVER_STATUSES = [
  // Pending + assigned driver is a legacy state.
  // Normal pending customer bookings have driver: null.
  "pending",
  "assigned",
  "accepted",
  "arriving_at_pickup",
  "arrived_at_pickup",
  "picked_up",
  "in_transit",
  "arrived_at_drop",
];

// Prevent clearing busy state during the normal booking-accept sequence.
const STALE_BUSY_GRACE_MS = 30 * 1000;

/**
 * Repairs legacy booking references and stale driver availability.
 *
 * This middleware does not create or delete bookings. It never automatically
 * marks a driver online.
 */
export async function reconcileStaleBusyDriver(req, res, next) {
  try {
    const driverUserId = req.user?.userId;

    if (!driverUserId) {
      return next();
    }

    const profile = await DriverProfile.findOne({
      user: driverUserId,
    })
      .select("_id availability updatedAt")
      .lean();

    if (!profile) {
      return next();
    }

    // Repair records created by an older implementation that may have stored
    // DriverProfile._id instead of User._id in Booking.driver.
    if (String(profile._id) !== String(driverUserId)) {
      const legacyBookingExists = await Booking.exists({
        driver: profile._id,
      });

      if (legacyBookingExists) {
        const migration = await Booking.updateMany(
          { driver: profile._id },
          { $set: { driver: driverUserId } }
        );

        if (migration.modifiedCount > 0) {
          console.info(
            `[driver-jobs] Repaired ${migration.modifiedCount} legacy booking driver reference(s)`
          );
        }
      }
    }

    if (profile.availability === "busy") {
      const staleBefore = new Date(
        Date.now() - STALE_BUSY_GRACE_MS
      );

      const updatedAt = profile.updatedAt
        ? new Date(profile.updatedAt)
        : new Date(0);

      // Do not touch a recently changed availability state.
      if (updatedAt <= staleBefore) {
        const activeBooking = await Booking.exists({
          driver: driverUserId,
          status: {
            $in: ACTIVE_DRIVER_STATUSES,
          },
        });

        if (!activeBooking) {
          const result = await DriverProfile.updateOne(
            {
              _id: profile._id,
              user: driverUserId,
              availability: "busy",
              updatedAt: {
                $lte: staleBefore,
              },
            },
            {
              $set: {
                availability: "offline",
              },
            }
          );

          if (result.modifiedCount > 0) {
            console.warn(
              `[driver-jobs] Cleared stale busy status for driver ${String(driverUserId)}; no active booking is assigned`
            );
          }
        }
      }
    }

    return next();
  } catch (error) {
    return next(error);
  }
}