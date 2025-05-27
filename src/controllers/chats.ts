import { Request, Response } from "express";
import User from "../models/user.js";
import Chat from "../models/chats.js";
import Message from "../models/message.js";
import asyncHandler from "../middlewares/tryCatch.js";
import { CustomError } from "../middlewares/errors/CustomError.js";
import mongoose from "mongoose";
import { scrapeDocs } from "../utils/scrape.js";
import googleAiClient from "../helpers/gemini.js";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import qdrantClient from "../helpers/qdrantClient.js";
import { QdrantVectorStore } from "@langchain/qdrant";
import { v4 as uuidv4 } from "uuid";
import embeddings from "../helpers/embeddings.js";

export const createChat = asyncHandler(async (req: Request, res: Response) => {
  const { clerkUserId } = req.params;
  const { title } = req.body;

  const user = await User.findOne({ clerkUserId }).select("_id");
  if (!user) {
    throw new CustomError("No user found!", 400);
  }

  const chat = new Chat({
    title,
    messages: [],
    userId: user?._id,
  });

  await chat.save();

  await User.updateOne({ clerkUserId }, { $push: { chats: chat._id } });

  res.status(201).json({ success: true, chatId: chat._id });
});

export const getDocsSimplified = asyncHandler(
  async (req: Request, res: Response) => {
    const { chatId } = req.params;
    const { prompt } = req.body;

    if (!prompt) {
      res.status(400).json({ error: "Prompt is required", success: false });
      return;
    }

    const httpsUrlRegex = /^https:\/\/[^\s/$.?#].[^\s]*$/i;

    if (!httpsUrlRegex.test(prompt)) {
      res.status(400).json({ error: "Prompt must be a valid HTTPS URL Only" });
      return;
    }

    try {
      const scrapedData = await scrapeDocs(prompt);

      const maxInputLength = 16000;

      const trimmedInput =
        scrapedData.length > maxInputLength
          ? scrapedData.slice(0, maxInputLength)
          : scrapedData;

      const stream = await googleAiClient.models.generateContentStream({
        model: "gemini-2.0-flash",
        contents: trimmedInput ? trimmedInput : prompt,
        config: {
          temperature: 0.2,
          systemInstruction: `You are a technical assistant specializing in simplifying technical documentation for beginners.

Your task:
- Carefully read and understand the scraped content provided.
- Summarize only the important and relevant parts in clear, beginner-friendly language.
- Use simple, real-world analogies where helpful.
- Provide simple code examples in relevant programming languages to illustrate concepts.
- Format your response using bullet points and code blocks when appropriate.
- Avoid technical jargon and overly complex explanations.
- If the scraped content does not contain enough information, answer based on your own knowledge, but state when you are doing so.
- Do not provide unrelated information or speculation.
- Keep the response concise and focused on teaching.

Respond clearly and helpfully.`,
        },
      });

      let string = "";

      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Transfer-Encoding", "chunked");

      try {
        for await (const chunk of stream) {
          if (chunk.text) {
            res.write(chunk.text);
            string += chunk.text;
          }
          if (res.flush) res.flush();
        }
        res.end();
      } catch (streamError) {
        if (!res.writableEnded) {
          res.end();
        }
      }
      const chat = await Chat.findById(chatId);

      if (!chat) {
        return new CustomError("Chat not found!", 400);
      }

      const userMessage = new Message({
        role: "user",
        content: prompt,
        chatId: chat._id,
      });

      const systemMessage = new Message({
        role: "assistant",
        content: string,
        chatId: chat._id,
      });
      await userMessage.save();
      await systemMessage.save();

      chat.messages.push(...[userMessage._id, systemMessage._id]);

      await chat.save();

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 50,
      });
      const texts = await textSplitter.splitText(scrapedData);
      const payloads = texts.map(() => ({ chatId: chat._id.toString() }));

      await QdrantVectorStore.fromTexts(texts, payloads, embeddings, {
        client: qdrantClient,
        collectionName: "chats_docs_chunks",
      });

      const replyEmbedding = await embeddings.embedQuery(string);
      await qdrantClient.upsert("chats_docs_chunks", {
        points: [
          {
            id: uuidv4(),
            vector: replyEmbedding,
            payload: {
              chatId: chatId.toString(),
              type: "assistant_response",
              content: string,
              timestamp: new Date().toISOString(),
            },
          },
        ],
      });
    } catch (error: unknown) {
      res
        .status(500)
        .json({ error: "Failed to generate response", success: false });
    }
  }
);

export const followUpOrStandAlone = asyncHandler(
  async (req: Request, res: Response) => {
    const { chatId } = req.params;
    const { prompt } = req.body;

    if (!prompt || !chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({
        error: !prompt
          ? "Prompt is required"
          : !chatId
            ? "Chat ID is required"
            : "Invalid chat ID",
        success: false,
      });
    }

    try {
      const chat = await Chat.exists({ _id: chatId });
      if (!chat) {
        return res
          .status(400)
          .json({ error: "Chat not found", success: false });
      }

      const orderedChatHistory = await Message.find({ chatId })
        .sort({ createdAt: -1 })
        .limit(15)
        .select("role content")
        .lean();

      const chatHistory = orderedChatHistory.reverse();

      const contents = [
        ...chatHistory.map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content || "" }],
        })),
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ];

      const classificationSystemPrompt = `
You are a conversation classification assistant.

Your task is to:
- Analyze the user's prompt and classify it as either:
  - "standalone" (can be understood without prior context), or
  - "follow-up" (depends on previous messages or conversation history)
- If it is a "follow-up", rewrite it as a complete, standalone question using the prior chat history.
- If it is "standalone", use the prompt itself as the question.
- The response should be a single JSON string that can be parsed directly.

Respond with a stringified JSON object exactly like this:

"{\\"type\\": \\"standalone\\" | \\"follow-up\\", \\"question\\": \\"<standalone form of the user’s input>\\"}"

Rules:
- Respond only with the JSON string, nothing else.
- Do not include any explanation, commentary, or extra text.
- Do not wrap your response in triple backticks (e.g., \`\`\`json).
- Ensure the output is a valid JSON string (properly escaped for a JSON string).
- The string should be ready to be parsed by JSON.parse() without errors.

Examples:

Input: "What is photosynthesis?"
Output: "{\\"type\\": \\"standalone\\", \\"question\\": \\"What is photosynthesis?\\"}"

Input: "What about the last point you mentioned?"
Output: "{\\"type\\": \\"follow-up\\", \\"question\\": \\"What was the last point you mentioned about plant cells?\\"}"
`;

      const classificationResponse =
        await googleAiClient.models.generateContent({
          model: "gemini-2.0-flash",
          contents,
          config: {
            temperature: 0,
            systemInstruction: classificationSystemPrompt,
          },
        });
      type classificationType = "follow-up" | "standalone";

      type classification = {
        type: classificationType;
        question: string;
      };
      let outputText = classificationResponse?.candidates?.[0]?.content
        ?.parts?.[0]?.text as string;

      if (outputText.startsWith("```")) {
        outputText = outputText
          .replace(/^```(?:json)?\n?/, "")
          .replace(/```$/, "")
          .trim();
      }

      let parsedOutput: classification;
      try {
        const intermediate = JSON.parse(outputText);

        if (typeof intermediate === "string") {
          parsedOutput = JSON.parse(intermediate);
        } else {
          parsedOutput = intermediate;
        }
      } catch (err) {
        parsedOutput = {
          type: "standalone",
          question: prompt,
        };
      }

      if (
        parsedOutput.type !== "follow-up" &&
        parsedOutput.type !== "standalone"
      ) {
        return res.status(400).json({
          error: "Invalid Question",
          success: false,
        });
      }

      let stream;
      let string = "";
      let promptEmbedding: number[] = [];

      if (parsedOutput.type === "standalone") {
        stream = await googleAiClient.models.generateContentStream({
          model: "gemini-2.0-flash",
          contents: [
            {
              role: "user",
              parts: [{ text: parsedOutput.question }],
            },
          ],
        });

        promptEmbedding = await embeddings.embedQuery(parsedOutput.question);
      } else {
        promptEmbedding = await embeddings.embedQuery(parsedOutput.question);

        const searchResult = await qdrantClient.search("chats_docs_chunks", {
          vector: promptEmbedding,
          limit: 5,
          filter: {
            must: [
              {
                key: "chatId",
                match: { value: chatId.toString() },
              },
            ],
          },
        });

        const relevantContexts = searchResult
          .map((item) => item.payload?.content)
          .filter(Boolean)
          .slice(0, 5)
          .join("\n");

        const contentsWithContext = [
          {
            role: "user",
            parts: [
              {
                text: `
You are a helpful and context-aware assistant.

Use the provided context to accurately answer the user's question. If the question is a follow-up, use the context to resolve references (like "my name", "that", "it", etc.) naturally. Do not repeat obvious information unnecessarily.

Guidelines:
- Be concise, clear, and human-like.
- Do not state facts that the user just told you unless truly needed.
- Avoid robotic or redundant statements like: "Ayush's name is Ayush."
- If the answer is already in the context, rephrase it naturally rather than echoing it.
- If something is unclear from the context, politely ask for clarification.

Context:
${relevantContexts}

Question:
${parsedOutput.question}
`.trim(),
              },
            ],
          },
        ];

        stream = await googleAiClient.models.generateContentStream({
          model: "gemini-2.0-flash",
          contents: contentsWithContext,
        });
      }

      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Transfer-Encoding", "chunked");

      try {
        for await (const chunk of stream) {
          if (chunk.text) {
            res.write(chunk.text);
            string += chunk.text;
          }
          if (res.flush) res.flush();
        }
        res.end();
      } catch (streamError) {
        if (!res.writableEnded) {
          res.end();
        }
      }

      const userMessage = new Message({
        role: "user",
        content: prompt,
        chatId,
      });
      const systemMessage = new Message({
        role: "assistant",
        content: string,
        chatId,
      });
      await userMessage.save();
      await systemMessage.save();

      await Chat.updateOne(
        { _id: chatId },
        { $push: { messages: { $each: [userMessage._id, systemMessage._id] } } }
      );

      const replyEmbedding = await embeddings.embedQuery(string);

      await qdrantClient.upsert("chats_docs_chunks", {
        points: [
          {
            id: uuidv4(),
            vector: promptEmbedding,
            payload: {
              chatId: chatId.toString(),
              type: "user_prompt",
              content: prompt,
              timestamp: new Date().toISOString(),
            },
          },
          {
            id: uuidv4(),
            vector: replyEmbedding,
            payload: {
              chatId: chatId.toString(),
              type: "assistant_response",
              content: string,
              timestamp: new Date().toISOString(),
            },
          },
        ],
      });

      return;
    } catch (error: unknown) {
      console.log(error);
      return res
        .status(500)
        .json({ error: "Failed to process request", success: false });
    }
  }
);

export const getChats = asyncHandler(async (req: Request, res: Response) => {
  const { clerkUserId } = req.params;

  const user = await User.findOne({ clerkUserId }).select("_id");

  if (!user) {
    throw new CustomError("No user found!", 400);
  }

  const chats = await Chat.find({ userId: user._id })
    .select("_id title createdAt")
    .sort({ createdAt: -1 });
  return res.status(200).json({ success: true, chats });
});

export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  const { chatId } = req.params;

  if (!chatId) {
    throw new CustomError("Chat ID is required!", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new CustomError("Invalid chat ID!", 400);
  }

  const messages = await Message.find({ chatId });
  return res
    .status(200)
    .json({ success: true, messages: messages || [], isValid: true });
});

export const updateChat = asyncHandler(async (req: Request, res: Response) => {
  const { chatId, clerkUserId } = req.params;
  const { title } = req.body;

  if (!chatId) {
    throw new CustomError("Chat ID is required!", 400);
  }

  if (!clerkUserId) {
    throw new CustomError("Clerk User ID is required!", 400);
  }

  if (!title) {
    throw new CustomError("Title is required!", 400);
  }

  const user = await User.findOne({ clerkUserId }).select("_id");

  if (!user) {
    throw new CustomError("No user found!", 400);
  }

  const chat = await Chat.findOne({ _id: chatId, userId: user._id });

  if (!chat) {
    throw new CustomError("Chat not found!", 400);
  }

  chat.title = title;

  await chat.save();
  return res
    .status(200)
    .json({ success: true, message: "Chat updated successfully" });
});

export const deleteChat = asyncHandler(async (req: Request, res: Response) => {
  const { chatId, clerkUserId } = req.params;

  if (!chatId) {
    throw new CustomError("Chat ID is required!", 400);
  }

  if (!clerkUserId) {
    throw new CustomError("Clerk User ID is required!", 400);
  }

  const user = await User.findOne({ clerkUserId }).select("_id");

  if (!user) {
    throw new CustomError("No user found!", 400);
  }

  const chat = await Chat.findOne({ _id: chatId, userId: user._id });

  if (!chat) {
    throw new CustomError("Chat not found!", 400);
  }

  await Promise.all([
    Chat.findByIdAndDelete(chatId),
    Message.deleteMany({ chatId }),
    User.updateOne({ clerkUserId }, { $pull: { chats: chatId } }),
  ]);
  return res
    .status(200)
    .json({ success: true, message: "Chat deleted successfully" });
});