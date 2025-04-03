import { Ollama } from "ollama";

const ollama = new Ollama({ host: process.env.OLLAMA_HOST });

export default ollama