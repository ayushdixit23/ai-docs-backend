import express, { Request, Response } from "express";
import { NODE_ENV, PORT, MONGO_URI } from "./utils/envConfig.js";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
// import connectDb from "./helpers/connectDb.js";
import compression from "compression";
import { errorMiddleware } from "./middlewares/errors/errorMiddleware.js";
import axios from "axios"

// Allowed origins for CORS
const allowedOrigins = ["http://localhost:3000", "http://localhost:3001"];

// Initialize Express app
const app = express();

// Connect to MongoDB
// connectDb(MONGO_URI); // Pass your MongoDB URI here

// Middlewares
app.use(helmet()); // Security headers

// Logging based on environment (development/production)
const logFormat = NODE_ENV === "development" ? "dev" : "combined";
app.use(morgan(logFormat));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json());

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"], // Allowed HTTP methods
    allowedHeaders: ["Content-Type", "Authorization"], // Allowed headers
    credentials: true, // Allow cookies to be sent
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
    return
  }

  try {
    // const response = await axios.post("http://192.168.1.15:11434/api/generate", {
    //   model: "llama3:8b",
    //   prompt: prompt,
    //   stream: false
    // });

    const response = await axios.post("http://192.168.1.15:11434/api/chat", {
      model: "llama3:8b",
      "messages": [
        {
          "role": "user",
          "content": prompt
        }
      ],
      stream: false
    });

    console.log(response.data)

    res.json(response.data);
  } catch (error: unknown) {
    console.error("Error communicating with Ollama:", (error as Error).message);
    res.status(500).json({ error: "Failed to communicate with Ollama" });
  }
});


// 404 Handler for non-existent routes (must come after routes)
app.use((_, res) => {
  res.status(404).json({ message: "Route not found" });
});


// Error Handling Middleware (must come after routes and 404 handler)
app.use(errorMiddleware);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
