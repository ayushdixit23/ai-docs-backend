import { QdrantVectorStore } from "@langchain/qdrant";
import embeddings from "./embeddings.js";
import qdrantClient from "./qdrantClient.js";

const vectorStore = new QdrantVectorStore(embeddings, {
    client: qdrantClient,
    collectionName: "chats_docs_chunks",
});

export default vectorStore;
