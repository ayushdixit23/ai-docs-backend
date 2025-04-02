import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
    {
        role: { type: String, default: "user", enum: ["user", "assistant"], required: true },
        content: { type: String, required: true },
        chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" }
    },
    { timestamps: true }
);

const Message = mongoose.model("Message", messageSchema);

export default Message;
