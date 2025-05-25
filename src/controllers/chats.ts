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

// export const generateAnswerForExistingChat = asyncHandler(
//     async (req: Request, res: Response) => {
//         const { chatId } = req.params;
//         const { prompt } = req.body;

//         if (!prompt) {
//             res.status(400).json({ error: "Prompt is required" });
//             return;
//         }

//         let stream:
//             | (AsyncIterable<{ message: { content: string } }> & {
//                 abort: () => void;
//             })
//             | undefined;

//         try {
//             let isUrl = false;
//             if (/^https:\/\/.+/.test(prompt)) {
//                 console.error("Invalid prompt:", prompt);
//                 isUrl = true;
//             }

//             if (isUrl) {
//                 const scrapedData = await scrapeDocs(prompt);

//                 const messages = [
//                     {
//                         role: "system" as const,
//                         content: `
//                     You are a technical assistant specialized in simplifying technical documentation.

//                     You have been provided with scraped content from the following URL: ${String(
//                             prompt
//                         )}

//                     Your task:
//                     - Read and understand the scraped content carefully.
//                     - Summarize the important and relevant parts in **clear, beginner-friendly language**.
//                     - Where applicable, provide **simple JavaScript code examples** to illustrate the concepts.
//                     - If the scraped content does not contain enough information to answer, politely mention it.

//                     Guidelines:
//                     - Avoid copying large portions of text directly.
//                     - Focus on **clarity**, **simplicity**, and **teaching the concept effectively**.
//                     - Only use the provided scraped data for your answers.
//                   `,
//                     },
//                     {
//                         role: "user" as const,
//                         content: String(scrapedData),
//                     },
//                 ];

//                 stream = await ollama.chat({
//                     model: "mistral:latest",
//                     // model: "llama3.1:8b",
//                     messages: messages,
//                     stream: true,
//                 });
//             } else {
//                 stream = await ollama.chat({
//                     model: "mistral:latest",
//                     // model: "llama3.1:8b",
//                     messages: [{ role: "user", content: prompt }],
//                     stream: true,
//                 });
//             }

//             let string = "";

//             res.setHeader("Content-Type", "text/plain");
//             res.setHeader("Transfer-Encoding", "chunked");
//             res.flushHeaders();

//             for await (const chunk of stream) {
//                 if (chunk.message?.content) {
//                     res.write(chunk.message.content);
//                     string += chunk.message.content;
//                 }
//                 if (res.flush) res.flush();
//             }

//             res.end();

//             const chat = await Chat.findById(chatId);

//             if (!chat) {
//                 return new CustomError("Chat not found!", 400);
//             }

//             const userMessage = new Message({
//                 role: "user",
//                 content: prompt,
//             });

//             const systemMessage = new Message({
//                 role: "assistant",
//                 content: string,
//             });
//             await userMessage.save();
//             await systemMessage.save();

//             chat.messages.push(...[userMessage._id, systemMessage._id]);

//             await chat.save();
//             userMessage.chatId = chat._id;
//             systemMessage.chatId = chat._id;
//             await Promise.all([userMessage.save(), systemMessage.save()]);
//         } catch (error: unknown) {
//             if ((error as Error).name === "AbortError") {
//                 console.log("Ollama request aborted.");
//                 res.end();
//             } else {
//                 console.error("Error streaming response from Ollama:", error);
//                 res.status(500).json({ error: "Failed to generate response" });
//             }
//         }
//     }
// );

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

export const generateAnswerForExistingChat = asyncHandler(
  async (req: Request, res: Response) => {
    const { chatId } = req.params;
    const { prompt } = req.body;

    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }

    try {
      const scrapedData = await scrapeDocs(prompt);
      if (!scrapedData) {
        return res.status(400).json({ error: "No meaningful content found." });
      }

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 50,
      });
      const texts = await textSplitter.splitText(scrapedData);

      res
        .status(200)
        .json({
          success: true,
          message: "Scraped data processed successfully",
          data: scrapedData,
        });
    } catch (error: unknown) {
      if ((error as Error).name === "AbortError") {
        console.log("Ollama request aborted.");
        res.end();
      } else {
        console.error("Error streaming response from Ollama:", error);
        res.status(500).json({ error: "Failed to generate response" });
      }
    }
  }
);

// export const generateAnswerForExistingChat = asyncHandler(
//   async (req: Request, res: Response) => {
//     const { chatId } = req.params;
//     const { prompt } = req.body;

//     if (!prompt) {
//       res.status(400).json({ error: "Prompt is required" });
//       return;
//     }

//     try {
//       const stream = await googleAiClient.models.generateContentStream({
//         model: "gemini-2.0-flash",
//         contents: prompt,
//       });

//       let string = "";

//       res.setHeader("Content-Type", "text/plain");
//       res.setHeader("Transfer-Encoding", "chunked");
//       res.flushHeaders();

//       for await (const chunk of stream) {
//         if (chunk.text) {
//           res.write(chunk.text);
//           string += chunk.text;
//         }
//         if (res.flush) res.flush();
//       }

//       const chat = await Chat.findById(chatId);

//       if (!chat) {
//         return new CustomError("Chat not found!", 400);
//       }

//       const userMessage = new Message({
//         role: "user",
//         content: prompt,
//       });

//       const systemMessage = new Message({
//         role: "assistant",
//         content: string,
//       });
//       await userMessage.save();
//       await systemMessage.save();

//       chat.messages.push(...[userMessage._id, systemMessage._id]);
//       await chat.save();
//       userMessage.chatId = chat._id;
//       systemMessage.chatId = chat._id;
//       await Promise.all([userMessage.save(), systemMessage.save()]);
//     } catch (error: unknown) {
//       if ((error as Error).name === "AbortError") {
//         console.log("Ollama request aborted.");
//         res.end();
//       } else {
//         console.error("Error streaming response from Ollama:", error);
//         res.status(500).json({ error: "Failed to generate response" });
//       }
//     }
//   }
// );

const cleanUp = async () => {
  console.log("Cleaning up...");
  await Chat.deleteMany();
  await Message.deleteMany();

  await User.findOneAndUpdate({}, { chats: [] });

  console.log("Cleanup complete.");
};
// cleanUp()

// export const generateAnswerForExistingChat = asyncHandler(
//   async (req: Request, res: Response) => {
//     const { chatId } = req.params;
//     const { prompt } = req.body;

//     if (!prompt) {
//       res.status(400).json({ error: "Prompt is required" });
//       return;
//     }

//     try {
//       const scrapedData = await scrapeDocs(prompt);
//       if (!scrapedData) {
//         return res.status(400).json({ error: "No meaningful content found." });
//       }

//       const maxInputLength = 16000;

//       const trimmedInput =
//         scrapedData.length > maxInputLength
//           ? scrapedData.slice(0, maxInputLength)
//           : scrapedData;

//       const stream = await googleAiClient.models.generateContentStream({
//         model: "gemini-2.0-flash",
//         contents: trimmedInput,
//         config: {
//           temperature: 0.2,
//           systemInstruction: `You are a technical assistant specializing in simplifying technical documentation for beginners.

// Your task:
// - Carefully read and understand the scraped content provided.
// - Summarize only the important and relevant parts in clear, beginner-friendly language.
// - Use simple, real-world analogies where helpful.
// - Provide simple code examples in relevant programming languages to illustrate concepts.
// - Format your response using bullet points and code blocks when appropriate.
// - Avoid technical jargon and overly complex explanations.
// - If the scraped content does not contain enough information, answer based on your own knowledge, but state when you are doing so.
// - Do not provide unrelated information or speculation.
// - Keep the response concise and focused on teaching.

// Respond clearly and helpfully.`,
//         },
//       });

//       let string = "";

//       res.setHeader("Content-Type", "text/plain");
//       res.setHeader("Transfer-Encoding", "chunked");
//       res.flushHeaders();

//       for await (const chunk of stream) {
//         if (chunk.text) {
//           res.write(chunk.text);
//           string += chunk.text;
//         }
//         if (res.flush) res.flush();
//       }

//       const textSplitter = new RecursiveCharacterTextSplitter({
//         chunkSize: 500,
//         chunkOverlap: 50,
//       });
//       const texts = await textSplitter.splitText(scrapedData);

//       const chat = await Chat.findById(chatId);

//       if (!chat) {
//         return new CustomError("Chat not found!", 400);
//       }

//       const userMessage = new Message({
//         role: "user",
//         content: prompt,
//       });

//       const systemMessage = new Message({
//         role: "assistant",
//         content: string,
//       });
//       await userMessage.save();
//       await systemMessage.save();

//       chat.messages.push(...[userMessage._id, systemMessage._id]);

//       await chat.save();
//       userMessage.chatId = chat._id;
//       systemMessage.chatId = chat._id;
//       await Promise.all([userMessage.save(), systemMessage.save()]);
//     } catch (error: unknown) {
//       if ((error as Error).name === "AbortError") {
//         console.log("Ollama request aborted.");
//         res.end();
//       } else {
//         console.error("Error streaming response from Ollama:", error);
//         res.status(500).json({ error: "Failed to generate response" });
//       }
//     }
//   }
// );
