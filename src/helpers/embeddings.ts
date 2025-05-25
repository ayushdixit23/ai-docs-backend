import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

const embeddings = new GoogleGenerativeAIEmbeddings({
    modelName: "embedding-001",
    apiKey: process.env.GEMINI_API_KEY,
});


export default embeddings;