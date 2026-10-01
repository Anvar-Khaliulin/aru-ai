/*
---ARU-LAB.SPACE---ALMATY---2026---
Semantic core generating vectors (embeddings) for text to enable Retrieval-Augmented Generation (RAG).
---chat.aru-lab.space---PWA---
*/
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.0';

env.allowLocalModels = false;
env.useBrowserCache = true;

export class SemanticCore {
    constructor() {
        this.pipe = null;
        this.modelName = 'Xenova/all-MiniLM-L6-v2'; // Lightweight and high-performance model for embeddings
        this.isLoading = false;
    }

    async init(progressCallback) {
        if (this.pipe) return;

        this.isLoading = true;
        try {
            // Initializes the feature-extraction pipeline
            this.pipe = await pipeline('feature-extraction', this.modelName, {
                progress_callback: (data) => {
                    if (progressCallback) {
                        // Data status is 'progress', data.progress ranges from 0-100
                        if (data.status === 'progress') {
                            progressCallback(Math.round(data.progress));
                        }
                    }
                }
            });
            console.log("Semantic Model Loaded");
        } catch (e) {
            console.error("Failed to load semantic model", e);
            throw e;
        } finally {
            this.isLoading = false;
        }
    }

    async getEmbedding(text) {
        if (!this.pipe) await this.init();

        // Computes embeddings using mean pooling and normalization
        const output = await this.pipe(text, { pooling: 'mean', normalize: true });

        // Transforms the resulting Tensor into a standard JavaScript array
        return Array.from(output.data);
    }
}

export const semanticCore = new SemanticCore();