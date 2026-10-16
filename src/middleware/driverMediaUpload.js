import multer from "multer";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const parser = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 0,
    parts: 1,
  },

  fileFilter(_req, file, callback) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(
        new Error(
          "Unsupported file type. Use JPG, PNG, WEBP or PDF."
        )
      );
    }

    callback(null, true);
  },
}).single("file");

export function receiveDriverMedia(req, res, next) {
  parser(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      const status =
        error.code === "LIMIT_FILE_SIZE" ? 413 : 400;

      return res.status(status).json({
        success: false,
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "The file is too large. Maximum size is 10 MB."
            : "Invalid upload request. Upload one file at a time.",
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message || "Invalid upload file.",
    });
  });
}