import dotenv from "dotenv";

dotenv.config();

export const circleConfig = {
  apiKey: process.env.CIRCLE_API_KEY,
};

export function validateCircleConfig() {
  const required = ["CIRCLE_API_KEY"];

  const missing = required.filter(
    (key) => !process.env[key]
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing Circle environment variables: ${missing.join(", ")}`
    );
  }

  console.log("✅ Circle configuration loaded.");
}
