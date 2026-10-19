import Booking from "../models/Booking.js";
import User from "../models/User.js";
import { isEmailServiceConfigured, sendTransactionalEmail } from "./emailService.js";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function money(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

async function bookingContext(bookingId) {
  return Booking.findById(bookingId)
    .populate("customer", "name email phone")
    .populate("driver", "name email phone")
    .populate("vehicle", "name slug capacityKg")
    .lean();
}

async function sendSafely(message) {
  if (!isEmailServiceConfigured()) {
    console.warn("LogiGo email notification not sent because SMTP is not configured");
    return false;
  }

  try {
    const result = await sendTransactionalEmail(message);
    return Boolean(result?.sent);
  } catch (error) {
    console.error("LogiGo notification email failed:", error.message);
    return false;
  }
}

async function getActiveAdmins() {
  return User.find({ role: "admin", isActive: true })
    .select("name email")
    .lean();
}

export async function notifyAdminsNewBooking(bookingId) {
  try {
    const [booking, admins] = await Promise.all([
      bookingContext(bookingId),
      getActiveAdmins(),
    ]);

    if (!booking || !admins.length) return;

    const vehicleName = booking.vehicle?.name || "Selected vehicle";
    const customerName = booking.customer?.name || "Customer";
    const recipients = admins.map((admin) => admin.email).filter(Boolean);
    if (!recipients.length) return;

    const text = [
      "A new LogiGo booking has been placed.",
      `Booking: ${booking.bookingCode}`,
      `Customer: ${customerName}`,
      `Vehicle: ${vehicleName}`,
      `Pickup: ${booking.pickup?.address || "Not provided"}`,
      `Destination: ${booking.drop?.address || "Not provided"}`,
      `Load: ${booking.package?.weightKg ?? "—"} kg`,
      `Estimated fare: ${money(booking.fare?.estimatedFare)}`,
      "Automatic driver dispatch has started.",
    ].join("\n");

    await sendSafely({
      to: recipients.join(","),
      subject: `New LogiGo booking ${booking.bookingCode}`,
      text,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;margin:auto;padding:24px"><h1>New LogiGo booking</h1><p>Automatic driver dispatch has started.</p><p><b>Booking:</b> ${escapeHtml(booking.bookingCode)}</p><p><b>Customer:</b> ${escapeHtml(customerName)}</p><p><b>Vehicle:</b> ${escapeHtml(vehicleName)}</p><p><b>Pickup:</b> ${escapeHtml(booking.pickup?.address || "Not provided")}</p><p><b>Destination:</b> ${escapeHtml(booking.drop?.address || "Not provided")}</p><p><b>Load:</b> ${escapeHtml(booking.package?.weightKg ?? "—")} kg</p><p><b>Estimated fare:</b> ${escapeHtml(money(booking.fare?.estimatedFare))}</p></div>`,
    });
  } catch (error) {
    console.error("Notify admin about new booking failed:", error.message);
  }
}

export async function notifyDriversOfBookingOffer(bookingId, driverIds, expiresAt) {
  try {
    if (!Array.isArray(driverIds) || !driverIds.length) return;

    const [booking, drivers] = await Promise.all([
      bookingContext(bookingId),
      User.find({
        _id: { $in: driverIds },
        role: "driver",
        isActive: true,
      })
        .select("name email")
        .lean(),
    ]);

    if (!booking || !drivers.length) return;

    const vehicleName = booking.vehicle?.name || "Selected vehicle";
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

    await Promise.allSettled(
      drivers.filter((driver) => driver.email).map((driver) => {
        const text = [
          `Hello ${driver.name || "Driver"},`,
          `A LogiGo delivery offer is available: ${booking.bookingCode}.`,
          `Vehicle category: ${vehicleName}`,
          `Pickup: ${booking.pickup?.address || "Not provided"}`,
          `Destination: ${booking.drop?.address || "Not provided"}`,
          `Package: ${booking.package?.description || "Package"} (${booking.package?.weightKg ?? "—"} kg)`,
          `Estimated fare: ${money(booking.fare?.estimatedFare)}`,
          `Offer expires at: ${new Date(expiresAt).toLocaleString("en-IN")}`,
          "Open your LogiGo driver workspace to accept or decline. The first eligible driver to accept receives the job; other offers become unavailable.",
          `${clientUrl}/driver/jobs`,
        ].join("\n");

        return sendSafely({
          to: driver.email,
          subject: `LogiGo delivery offer · ${booking.bookingCode}`,
          text,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;margin:auto;padding:24px"><div style="display:inline-block;background:#f97316;color:white;border-radius:10px;padding:8px 12px;font-weight:800">LogiGo</div><h1>New delivery offer</h1><p>Hello ${escapeHtml(driver.name || "Driver")}, a delivery matching your approved vehicle is available.</p><p><b>Booking:</b> ${escapeHtml(booking.bookingCode)}</p><p><b>Vehicle category:</b> ${escapeHtml(vehicleName)}</p><p><b>Pickup:</b> ${escapeHtml(booking.pickup?.address || "Not provided")}</p><p><b>Destination:</b> ${escapeHtml(booking.drop?.address || "Not provided")}</p><p><b>Package:</b> ${escapeHtml(booking.package?.description || "Package")} (${escapeHtml(booking.package?.weightKg ?? "—")} kg)</p><p><b>Estimated fare:</b> ${escapeHtml(money(booking.fare?.estimatedFare))}</p><p><b>Offer expiry:</b> ${escapeHtml(new Date(expiresAt).toLocaleString("en-IN"))}</p><p>The first eligible driver to accept receives the job. Other offers will become unavailable automatically.</p><p><a href="${escapeHtml(`${clientUrl}/driver/jobs`)}" style="display:inline-block;background:#f97316;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Open driver jobs</a></p></div>`,
        });
      })
    );
  } catch (error) {
    console.error("Notify drivers about booking offer failed:", error.message);
  }
}

export async function notifyBookingStatusToCustomer(bookingId, status, note = "") {
  try {
    const booking = await bookingContext(bookingId);
    const customer = booking?.customer;
    if (!booking || !customer?.email) return;

    const text = [
      `Your LogiGo booking ${booking.bookingCode} status has changed.`,
      `Current status: ${status.replaceAll("_", " ")}`,
      note,
      `View your order: ${(process.env.CLIENT_URL || "http://localhost:5173")}/customer/orders`,
    ].filter(Boolean).join("\n");

    await sendSafely({
      to: customer.email,
      subject: `LogiGo booking update · ${booking.bookingCode}`,
      text,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;margin:auto;padding:24px"><h1>Booking status updated</h1><p>Your booking <b>${escapeHtml(booking.bookingCode)}</b> has a new status:</p><p style="font-size:18px;font-weight:800">${escapeHtml(status.replaceAll("_", " "))}</p>${note ? `<p>${escapeHtml(note)}</p>` : ""}<p>Open your LogiGo account to see the latest details.</p></div>`,
    });
  } catch (error) {
    console.error("Notify customer about booking status failed:", error.message);
  }
}

export async function notifyAdminsDispatchExhausted(bookingId) {
  try {
    const [booking, admins] = await Promise.all([
      bookingContext(bookingId),
      getActiveAdmins(),
    ]);

    if (!booking || !admins.length) return;
    const recipients = admins.map((admin) => admin.email).filter(Boolean);
    if (!recipients.length) return;

    const text = `No eligible online driver has accepted LogiGo booking ${booking.bookingCode}. The booking remains pending and automatic dispatch will retry when another eligible driver becomes available.`;

    await sendSafely({
      to: recipients.join(","),
      subject: `LogiGo dispatch needs attention · ${booking.bookingCode}`,
      text,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;margin:auto;padding:24px"><h1>Automatic dispatch needs attention</h1><p>No eligible online driver is available for booking <b>${escapeHtml(booking.bookingCode)}</b> at the moment.</p><p>The booking remains pending. Dispatch will retry when another eligible driver becomes available.</p></div>`,
    });
  } catch (error) {
    console.error("Notify admin about exhausted dispatch failed:", error.message);
  }
}
