import express from "express"
import { createChat, deleteChat, followUpOrStandAlone, getChats, getDocsSimplified, getMessages, updateChat } from "../controllers/chats.js"
const router = express.Router()

router.post("/followUpOrStandAlone/:chatId", followUpOrStandAlone)
router.post("/getDocsScrapeData/:chatId", getDocsSimplified)
router.post("/createChat/:clerkUserId", createChat)
router.get("/getChats/:clerkUserId", getChats)
router.get("/getMessages/:chatId", getMessages)
router.put("/updateChatTitle/:chatId/:clerkUserId", updateChat)
router.delete("/deleteChat/:chatId/:clerkUserId", deleteChat)

export default router