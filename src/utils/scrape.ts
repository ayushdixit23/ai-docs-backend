import axios from "axios";
import * as cheerio from "cheerio";
import { htmlToText } from "html-to-text";

export async function scrapeDocs(url: string): Promise<string> {
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (AI Scraper Bot)',
                'Accept': 'text/html',
            }
        });

        const $ = cheerio.load(data);
        
        const containers = ['main', 'article', '#__next', '.markdown', '.docs-content', 'body'];
        let content: string | null = null;

        for (const selector of containers) {
            const candidate = $(selector).first();
            if (candidate && candidate.text().trim().length > 100) {
                content = candidate.html() || '';
                break;
            }
        }

        if (!content) {
            return "";
        }

        const cleanText = htmlToText(content, {
            wordwrap: false,
            selectors: [
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'code', format: 'inline' },
                { selector: 'pre', format: 'block' },
                { selector: 'h1', format: 'heading' },
                { selector: 'h2', format: 'heading' },
                { selector: 'h3', format: 'heading' },
            ]
        });

        return cleanText.trim();
    } catch (error: any) {
        console.error("Error scraping document:", error.message);
        return "";
    }
}