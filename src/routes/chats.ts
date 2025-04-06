import express from "express"
import { createChat, generateAnswerForExistingChat, getChats, getMessages } from "../controllers/chats.js"
const router = express.Router()

// router.post("/generate", generateAnswer)
router.post("/generate/:chatId", generateAnswerForExistingChat)
router.post("/createChat/:clerkUserId", createChat)
router.get("/getChats/:clerkUserId", getChats)
router.get("/getMessages/:chatId", getMessages)

export default router