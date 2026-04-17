const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: "ticket_attachments",

      /* 🔥 CRITICAL FIX */
      resource_type: "auto", // ✅ allows pdf, images, etc.

      allowed_formats: ["jpg", "png", "jpeg", "pdf"], // ✅ include pdf
    };
  },
});

const upload = multer({ storage });

module.exports = upload;