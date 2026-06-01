import { v2 as cloudinary } from "cloudinary";

const CLOUDINARY_ENV_KEYS = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

export const configureCloudinaryFromEnv = () => {
  cloudinary.config(true);

  const explicitConfig = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  };

  const hasExplicitValue = CLOUDINARY_ENV_KEYS.some((key) => process.env[key]);
  if (hasExplicitValue) {
    cloudinary.config(
      Object.fromEntries(
        Object.entries(explicitConfig).filter(([, value]) => Boolean(value))
      )
    );
  }

  return cloudinary.config();
};

export const hasCloudinaryCredentials = () => {
  const config = configureCloudinaryFromEnv();
  return Boolean(config.cloud_name && config.api_key && config.api_secret);
};

export const assertCloudinaryConfigured = () => {
  if (hasCloudinaryCredentials()) return;

  const error = new Error("Cloudinary not configured");
  error.status = 503;
  error.code = "IMAGE_UPLOAD_NOT_CONFIGURED";
  throw error;
};
