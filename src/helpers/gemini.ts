import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY } from '../utils/envConfig.js';

const googleAiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export default googleAiClient;

