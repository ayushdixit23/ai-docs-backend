import axios from "axios";
import * as cheerio from "cheerio";
import { htmlToText } from "html-to-text";

export async function scrapeDocs(url: string) {
    if (!url || !/^https:\/\/.+/.test(url)) {
        console.error("Invalid URL:", url);
        return null;
    }
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const mainContent = $('main').html() || $('article').html() || $('body').html();
        const cleanText = htmlToText(mainContent || "", { wordwrap: 130 });
        return cleanText
    } catch (error: any) {
        console.error("Error scraping document:", error.message);
        return null; // Ensure function always returns something
    }
}