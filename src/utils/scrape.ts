import axios from "axios";
import * as cheerio from "cheerio"; // Import correctly

export async function scrapeDocs(url: string) {
    if (!url || !/^https:\/\/.+/.test(url)) {
        console.error("Invalid URL:", url);
        return null;
    }
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data); // Corrected usage

        const title = $("title").text().trim(); // Extracts page title
        const content = $("article").text().trim(); // Extracts main doc content

        return { title, content };
    } catch (error:any) {
        console.error("Error scraping document:", error.message);
        return null; // Ensure function always returns something
    }
}




// export async function scrapeDocs(url:string) {
//     const browser = await puppeteer.launch({ headless: true }); // Run in headless mode
//     const page = await browser.newPage();

//     await page.goto(url, { waitUntil: "networkidle2" }); // Wait for JS to finish loading

//     // Extract data from the page
//     const data = await page.evaluate(() => ({
//         title: document.title,
//         headings: Array.from(document.querySelectorAll("h1, h2, h3")).map(h => h.innerText),
//         paragraphs: Array.from(document.querySelectorAll("article p")).map(p => p.innerText), // ✅ Get all paragraphs
//         fullText: document.querySelector("article")?.innerText || "No content found" // ✅ Backup: full text
//     }));

//     await browser.close();
//     return data;
// }

