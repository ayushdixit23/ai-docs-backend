import dotenv from 'dotenv';

dotenv.config();

export const PORT = process.env.PORT
export const NODE_ENV = process.env.NODE_ENV
export const MONGO_URI = process.env.MONGO_URI || ""
export const CLERK_WEBHOOK_SECRET_KEY = process.env.CLERK_WEBHOOK_SECRET_KEY || ""
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""
