import express, { Request, Response } from "express";
import { CLERK_WEBHOOK_SECRET_KEY, MONGO_URI, NODE_ENV, PORT } from "./utils/envConfig.js";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { errorMiddleware } from "./middlewares/errors/errorMiddleware.js";
import { Ollama } from "ollama";
import bodyParser from "body-parser";
import { Webhook } from "svix";
import User from "./models/user.js";
import connectDb from "./helpers/connectDb.js";

const ollama = new Ollama({ host: "http://192.168.1.15:11434" });

// Allowed origins for CORS
const allowedOrigins = ["http://localhost:3000", "http://localhost:3001"];

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

app.post("/chat", async (req: Request, res: Response): Promise<void> => {
  const { prompt } = req.body;

  if (!prompt) {
    res.status(400).json({ error: "Prompt is required" });
    return;
  }

  try {
    // Set response headers for streaming
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const stream = await ollama.chat({
      model: "llama3:8b",
      messages: [{ role: "user", content: prompt }],
      stream: true, // Enable streaming
    });

    for await (const chunk of stream) {
      console.log(chunk.message, "message");

      res.write(chunk.message.content); // Send each chunk to client
      res.flush(); // 🛠 Ensure data is sent immediately
    }

    res.end(); // End response when streaming is complete
  } catch (error: unknown) {
    console.error("Error streaming response from Ollama:", error);
    res.status(500).json({ error: "Failed to stream response from Ollama" });
  }
});

// Use raw body parser to handle verification properly
// app.post(
//   "/api/webhook",
//   async (req: Request, res: Response): Promise<void> => {
//     console.log("✅ WebHook Triggered!");

//     const svix_id = req.headers["svix-id"] as string;
//     const svix_timestamp = req.headers["svix-timestamp"] as string;
//     const svix_signature = req.headers["svix-signature"] as string;

//     if (!svix_id || !svix_timestamp || !svix_signature) {
//       console.error("❌ Missing Svix Headers");
//       res.status(400).json({ success: false, message: "Missing required headers" });
//       return
//     }

//     // Convert raw buffer to string
//     const payloadString = req.body.toString();

//     try {
//       const wh = new Webhook(CLERK_WEBHOOK_SECRET_KEY);
//       const evt = wh.verify(payloadString, {
//         "svix-id": svix_id,
//         "svix-timestamp": svix_timestamp,
//         "svix-signature": svix_signature,
//       });

//       if (evt?.type === "user.created") {

//         const { id, image_url, last_name, first_name, email_addresses } = evt.data

//         const user = new User({
//           clerkUserId: id,
//           email: email_addresses[0].email_address,
//           image: image_url,
//           firstName: first_name,
//           lastName: last_name,
//         })

//         await user.save()
//       }

//       if (evt?.type === "user.updated") {

//         const { id, image_url, last_name, first_name, email_addresses } = evt.data

//         const user = await User.findOne({ clerkUserId: id })
//         if (!user) {
//           res.status(400).json({ success: false, message: "User not found!" })
//           return
//         }

//         user.firstName = first_name

//         user.lastName = last_name

//         user.email = email_addresses[0].email_address

//         user.image = image_url

//         await user.save()
//       }

//       if (evt?.type === "user.deleted") {

//         const { id } = evt?.data

//         await User.findOneAndDelete({ clerkUserId: id })
//       }

//       res.status(200).json({ success: true, message: "Webhook processed" });

//     } catch (err) {
//       console.error("❌ Webhook verification failed:", err);
//       res.status(400).json({ success: false, message: "Verification failed" });
//     }
//   }
// );

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
  console.log("✅ WebHook Triggered!");

  const svix_id = req.headers["svix-id"] as string;
  const svix_timestamp = req.headers["svix-timestamp"] as string;
  const svix_signature = req.headers["svix-signature"] as string;

  if (!svix_id || !svix_timestamp || !svix_signature) {
    console.error("❌ Missing Svix Headers");
    return res.status(400).json({ success: false, message: "Missing required headers" });
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
      console.error("❌ Invalid event");
      return res.status(400).json({ success: false, message: "Invalid event data" });
    }

    switch (evt?.type) {
      case "user.created":
      case "user.updated":
        await handleUserData(evt);
        break;

      case "user.deleted":
        const { id } = evt?.data;
        await User.findOneAndDelete({ clerkUserId: id });
        break;

      default:
        console.warn(`⚠️ Unhandled event type: ${evt?.type}`);
        break;
    }

    return res.status(200).json({ success: true, message: "Webhook processed" });

  } catch (err) {
    console.error("❌ Webhook verification failed:", err);
    return res.status(500).json({ success: false, message: "Server error during webhook processing" });
  }
};

app.post("/api/webhook", processWebhook);

// 404 Handler for non-existent routes
app.use((_, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error Handling Middleware
app.use(errorMiddleware);


connectDb(MONGO_URI)

// Start server
app.listen(PORT, () => {
  console.log(`Server is running at port ${PORT}`);
});
