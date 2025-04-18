import express from "express"
import { createChat, deleteChat, generateAnswerForExistingChat, getChats, getMessages, updateChat } from "../controllers/chats.js"
const router = express.Router()

// router.post("/generate", generateAnswer)
router.post("/generate/:chatId", generateAnswerForExistingChat)
router.post("/createChat/:clerkUserId", createChat)
router.get("/getChats/:clerkUserId", getChats)
router.get("/getMessages/:chatId", getMessages)
router.put("/updateChatTitle/:chatId/:clerkUserId", updateChat)
router.delete("/deleteChat/:chatId/:clerkUserId", deleteChat)

export default router