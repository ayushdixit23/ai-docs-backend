import express, { Request, Response } from "express";
import {
  CLERK_WEBHOOK_SECRET_KEY,
  MONGO_URI,
  NODE_ENV,
  PORT,
} from "./utils/envConfig.js";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { errorMiddleware } from "./middlewares/errors/errorMiddleware.js";
import bodyParser from "body-parser";
import { Webhook } from "svix";
import User from "./models/user.js";
import connectDb from "./helpers/connectDb.js";
import chatRouter from "./routes/chats.js"

// Allowed origins for CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://192.168.1.2:3000",
  "http://192.168.1.3:3000",
  "http://192.168.1.4:3000",
  "http://192.168.1.5:3000",
  "http://192.168.1.10:3000",
];

// Initialize Express app
const app = express();

// Middlewares
app.use(helmet()); // Security headers

// Logging based on environment (development/production)
const logFormat = NODE_ENV === "development" ? "dev" : "combined";
app.use(morgan(logFormat));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use("/api/webhook", bodyParser.raw({ type: "application/json" }));
app.use(express.json());

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`Blocked by CORS: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Routes
app.get("/", (_, res) => {
  res.send("Server is running!");
});

app.use("/api", chatRouter)

const handleUserData = async (event: any) => {
  const { id, image_url, last_name, first_name, email_addresses } = event.data;

  const user = await User.findOne({ clerkUserId: id });

  if (user) {
    // Update existing user
    user.firstName = first_name;
    user.lastName = last_name;
    user.email = email_addresses[0].email_address;
    user.image = image_url;
    await user.save();
  } else {
    // Create new user
    const newUser = new User({
      clerkUserId: id,
      email: email_addresses[0].email_address,
      image: image_url,
      firstName: first_name,
      lastName: last_name,
    });
    await newUser.save();
  }
};

const processWebhook = async (req: Request, res: Response): Promise<any> => {

  const svix_id = req.headers["svix-id"] as string;
  const svix_timestamp = req.headers["svix-timestamp"] as string;
  const svix_signature = req.headers["svix-signature"] as string;

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required headers" });
  }

  const payloadString = req.body.toString();

  try {
    const wh = new Webhook(CLERK_WEBHOOK_SECRET_KEY);
    const evt = wh.verify(payloadString, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    });

    if (!evt) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid event data" });
    }

    // @ts-ignore
    switch (evt?.type) {
      case "user.created":
      case "user.updated":
        await handleUserData(evt);
        break;

      case "user.deleted":
        // @ts-ignore
        const { id } = evt?.data;
        await User.findOneAndDelete({ clerkUserId: id });
        break;

      default:
        break;
    }

    return res
      .status(200)
      .json({ success: true, message: "Webhook processed" });
  } catch (err) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error during webhook processing",
      });
  }
};

app.post("/api/webhook", processWebhook);

// 404 Handler for non-existent routes
app.use((_, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error Handling Middleware
app.use(errorMiddleware);

connectDb(MONGO_URI);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running at port ${PORT}`);
});
