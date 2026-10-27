import mongoose from "mongoose";
import EnterpriseEnquiry from "../models/EnterpriseEnquiry.js";

const allowedStatuses = new Set(["new", "contacted", "qualified", "closed"]);

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function createEnterpriseEnquiry(req, res, next) {
  try {
    const {
      contactName,
      email,
      phone,
      companyName,
      city,
      monthlyShipmentVolume,
      services,
      message,
    } = req.body;

    const enquiry = await EnterpriseEnquiry.create({
      contactName,
      email,
      phone,
      companyName,
      city,
      monthlyShipmentVolume,
      services,
      message,
      source: "website",
    });

    return res.status(201).json({
      success: true,
      message: "Your business enquiry has been received.",
      enquiry: {
        enquiryCode: enquiry.enquiryCode,
        status: enquiry.status,
        createdAt: enquiry.createdAt,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return sendError(res, 409, "We could not create a unique enquiry reference. Please submit again.");
    }
    if (error instanceof mongoose.Error.ValidationError) {
      return sendError(res, 400, "Please check the enquiry details and try again.");
    }
    return next(error);
  }
}

export async function getAdminEnterpriseEnquiries(req, res, next) {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || "25"), 10) || 25));

    if (status !== "all" && !allowedStatuses.has(status)) {
      return sendError(res, 400, "Choose a valid enquiry status filter.");
    }

    const filter = {};
    if (status !== "all") filter.status = status;
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { enquiryCode: expression },
        { contactName: expression },
        { email: expression },
        { companyName: expression },
        { phone: expression },
      ];
    }

    const skip = (page - 1) * limit;
    const [enquiries, total, grouped] = await Promise.all([
      EnterpriseEnquiry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("enquiryCode contactName email phone companyName city monthlyShipmentVolume services message status adminNotes createdAt updatedAt")
        .lean(),
      EnterpriseEnquiry.countDocuments(filter),
      EnterpriseEnquiry.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const byStatus = { new: 0, contacted: 0, qualified: 0, closed: 0 };
    for (const item of grouped) {
      if (Object.prototype.hasOwnProperty.call(byStatus, item._id)) {
        byStatus[item._id] = item.count;
      }
    }

    return res.status(200).json({
      success: true,
      enquiries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      summary: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        ...byStatus,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateAdminEnterpriseEnquiry(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return sendError(res, 400, "A valid enquiry ID is required.");
    }

    const updates = {};
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.adminNotes !== undefined) updates.adminNotes = req.body.adminNotes;

    const enquiry = await EnterpriseEnquiry.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("enquiryCode contactName email phone companyName city monthlyShipmentVolume services message status adminNotes createdAt updatedAt").lean();

    if (!enquiry) return sendError(res, 404, "Business enquiry not found.");

    return res.status(200).json({
      success: true,
      message: "Business enquiry updated.",
      enquiry,
    });
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      return sendError(res, 400, "The enquiry update is invalid.");
    }
    return next(error);
  }
}
