import express from "express"
import { generateAnswer, getChats, getMessages } from "../controllers/chats.js"
const router = express.Router()

router.post("/generate", generateAnswer)
router.get("/getChats/:clerkUserId", getChats)
router.get("/getMessages/:chatId",getMessages)

export default router