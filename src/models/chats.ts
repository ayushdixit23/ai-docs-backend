import mongoose from "mongoose";

const chatScema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        messages: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }],
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    { timestamps: true }
);

const Chat = mongoose.model("Chat", chatScema);

export default Chat;
