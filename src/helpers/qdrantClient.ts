import { QdrantClient } from '@qdrant/js-client-rest';

const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_HOST,
});

// Auto-create 'chats_docs_chunks' collection if it doesn't exist
export async function ensureChatsDocsChunksCollection() {
    try {
        const collections = await qdrantClient.getCollections();
        const exists = collections.collections.some(
            (col) => col.name === 'chats_docs_chunks'
        );

        if (!exists) {
            await qdrantClient.createCollection('chats_docs_chunks', {
                vectors: {
                    size: 1536, // Adjust this if you're using a different embedding size
                    distance: 'Cosine',
                },
            });
            console.log('✅ Collection "chats_docs_chunks" created.');
        } else {
            console.log('ℹ️ Collection "chats_docs_chunks" already exists.');
        }
    } catch (error) {
        // @ts-ignore
        console.error('❌ Failed to ensure Qdrant collection:', error?.message);
    }
}

export default qdrantClient;
