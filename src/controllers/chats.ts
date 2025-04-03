import { Request, Response } from "express"
import ollama from "../helpers/ollama.js";
import User from "../models/user.js";
import Chat from "../models/chats.js";
import Message from "../models/message.js";
import asyncHandler from "../middlewares/tryCatch.js";
import { CustomError } from "../middlewares/errors/CustomError.js";

export const generateAnswer = asyncHandler(async (req: Request, res: Response) => {
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
})

export const getChats = asyncHandler(async (req: Request, res: Response) => {
    const { clerkUserId } = req.params

    const user = await User.findOne({ clerkUserId }).select("_id")

    if (!user) {
        throw new CustomError("No user found!", 400)
    }

    const chats = await Chat.find({ userId: user._id }).select("_id title createdAt").sort({ createdAt: -1 })
    return res.status(200).json({ success: true, chats })
})

export const getMessages = asyncHandler(async (req: Request, res: Response) => {
    const { chatId } = req.params
    const messages = await Message.find({ chatId })
    return res.status(200).json({ success: true, messages: messages || [] })
})

