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
import { Ollama } from "ollama";
import bodyParser from "body-parser";
import { Webhook } from "svix";
import User from "./models/user.js";
import connectDb from "./helpers/connectDb.js";
import Chat from "./models/chats.js";
import Message from "./models/message.js";

const ollama = new Ollama({ host: process.env.OLLAMA_HOST });

// Allowed origins for CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://192.168.1.2:3000",
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

app.post("/chat", async (req: Request, res: Response): Promise<void> => {
  const { prompt, clerkUserId } = req.body;

  if (!prompt) {
    res.status(400).json({ error: "Prompt is required" });
    return;
  }
  try {
    let stream;
    let isUrl = true;
    if (!prompt || !/^https:\/\/.+/.test(prompt)) {
      console.error("Invalid prompt:", prompt);
      isUrl = false;
    }

    if (isUrl) {
      const messages = [
        {
          role: "system",
          content: `Your task is to help the user by scraping data from this url: ${prompt} , and using the information from this scraped data. This scraped data contains useful details that should be used to answer the user's question.

            When responding:
            1. Focus only on the relevant parts of the data.
            2. Summarize information in a clear and simple way.
            3. If the data does not have an answer, say so politely.
            4. Provide code examples when needed to make the response easier to understand.
            `,
        },
        { role: "user", content: prompt },
      ];

      console.log(messages, "messages");

      stream = await ollama.chat({
        model: "mistral",
        messages: messages,
        stream: true,
      });
    } else {
      stream = await ollama.chat({
        model: "mistral",
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });
    }
    let string = "";

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    for await (const chunk of stream) {
      console.log(chunk.message.content, "message");
      res.write(chunk.message.content);
      string += chunk.message.content;
      res.flush();
    }

    res.end();
    console.log("final", string);

    const user = await User.findOne({ clerkUserId }).select("_id")
    let chat = await Chat.findOne()

    const userMessage = new Message({
      role: "user",
      content: prompt,
    })

    const systemMessage = new Message({
      role: "assistant",
      content: string,
    })

    await Promise.all([userMessage.save(), systemMessage.save()])

    if (!chat) {
      chat = new Chat({
        title: prompt,
        messages: [userMessage._id, systemMessage._id],
        userId: user?._id
      })
    } else {
      chat.messages.push(...[userMessage._id, systemMessage._id]);
    }

    await chat.save()

    userMessage.chatId = chat._id
    systemMessage.chatId = chat._id
    await Promise.all([userMessage.save(), systemMessage.save()])

  } catch (error: unknown) {
    if ((error as Error).name === "AbortError") {
      console.log("Ollama request aborted.");
      res.end();
    } else {
      console.error("Error streaming response from Ollama:", error);
      res.status(500).json({ error: "Failed to generate response" });
    }
  }
});

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
      console.error("❌ Invalid event");
      return res
        .status(400)
        .json({ success: false, message: "Invalid event data" });
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

    return res
      .status(200)
      .json({ success: true, message: "Webhook processed" });
  } catch (err) {
    console.error("❌ Webhook verification failed:", err);
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
