import { ChromaClient } from 'chromadb';

const client = new ChromaClient({
    path: "http://localhost:8009"
});

export default client;
