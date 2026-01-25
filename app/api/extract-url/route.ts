import { NextResponse } from "next/server";
import { Readability } from "@mozilla/readability";
import { DOMParser } from "linkedom";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

interface SpeechItem {
  text: string;
  reader_id: string;
}

interface ProcessedSection {
  title: string;
  level?: number;
  content: {
    speech: SpeechItem[];
  };
}

// Capture a screenshot of the webpage using Puppeteer with serverless Chromium
async function captureScreenshot(url: string): Promise<string | null> {
  let browser = null;
  try {
    // Use different config for local dev vs serverless (Vercel)
    const isLocal = process.env.NODE_ENV === "development";

    browser = await puppeteer.launch({
      args: isLocal ? [] : chromium.args,
      defaultViewport: { width: 800, height: 1200 },
      executablePath: isLocal
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();

    // Navigate to the URL with a timeout
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Wait a bit for any JavaScript to render
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Capture screenshot of the full viewport
    const screenshotBuffer = await page.screenshot({
      type: "png",
    });

    await browser.close();

    // Resize to thumbnail size (300x450) with WebP compression
    const resizedBuffer = await sharp(screenshotBuffer)
      .resize(300, 450)
      .webp({
        quality: 40,
        effort: 6, // Compression effort (0-6, higher = smaller file)
      })
      .toBuffer();

    // Convert to data URL
    const base64 = resizedBuffer.toString("base64");
    return `data:image/webp;base64,${base64}`;
  } catch (error) {
    console.error("Screenshot capture error:", error);
    if (browser) {
      await browser.close();
    }
    return null;
  }
}

function parseHtmlToSections(html: string): { sections: ProcessedSection[] } {
  const parser = new DOMParser();
  // Wrap in full HTML structure to ensure body exists
  const wrappedHtml = `<!DOCTYPE html><html><body>${html}</body></html>`;
  const doc = parser.parseFromString(wrappedHtml, "text/html");
  const sections: ProcessedSection[] = [];
  let currentSection: ProcessedSection | null = null;

  // Query block-level elements in document order
  const body = doc.body || doc.querySelector("body");
  if (!body) {
    return { sections: [] };
  }
  const elements = Array.from(
    body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, div")
  );

  for (const el of elements) {
    const tagName = el.tagName.toLowerCase();
    const text = el.textContent?.trim();
    if (!text) continue;

    // Skip divs that contain other block elements (avoid duplicates)
    if (tagName === "div") {
      const hasBlockChildren = el.querySelector(
        "h1, h2, h3, h4, h5, h6, p, li, blockquote, div"
      );
      if (hasBlockChildren) continue;
    }

    if (tagName.startsWith("h")) {
      // Start new section
      if (currentSection) sections.push(currentSection);
      const level = Math.min(parseInt(tagName[1]), 4);
      currentSection = {
        title: text,
        level,
        content: { speech: [] },
      };
    } else {
      // Add to current section
      if (!currentSection) {
        currentSection = { title: "", content: { speech: [] } };
      }
      currentSection.content.speech.push({
        text,
        reader_id: "Narrator",
      });
    }
  }

  if (currentSection) sections.push(currentSection);
  return { sections };
}

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL format" },
        { status: 400 }
      );
    }

    // Fetch the webpage
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Speechable/1.0; +https://speechable.app)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
        },
        { status: 400 }
      );
    }

    const html = await response.text();

    // Parse with linkedom and extract with Readability
    const parser = new DOMParser();
    const document = parser.parseFromString(html, "text/html");

    // Readability modifies the DOM, so we need to clone it
    const docClone = document.cloneNode(true) as typeof document;

    // Set up the document URL for Readability (it needs documentURI)
    Object.defineProperty(docClone, "documentURI", {
      value: url,
      writable: false,
    });

    const reader = new Readability(docClone as unknown as Document);
    const article = reader.parse();

    if (!article || !article.content) {
      return NextResponse.json(
        { error: "Could not extract meaningful content from this URL" },
        { status: 400 }
      );
    }

    const title = article.title || parsedUrl.hostname;
    const text = article.textContent?.trim() || "";

    // Check if we got meaningful content
    if (text.length < 50) {
      return NextResponse.json(
        { error: "Could not extract meaningful content from this URL" },
        { status: 400 }
      );
    }

    // Parse HTML structure into sections
    const { sections } = parseHtmlToSections(article.content);

    // If first section has no title, use the article title
    if (sections.length > 0 && !sections[0].title) {
      sections[0].title = title;
      sections[0].level = 1;
    }

    // Build processed_text structure
    const processed_text = {
      processed_text: {
        sections,
      },
    };

    // Capture screenshot of the webpage (run in parallel with content extraction completion)
    const screenshotDataUrl = await captureScreenshot(url);

    // Build the response
    const result = {
      title,
      author: article.byline || null,
      text,
      description: article.excerpt || null,
      image: null,
      siteName: article.siteName || null,
      lang: article.lang || null,
      processed_text,
      screenshotDataUrl,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("URL extraction error:", error);
    return NextResponse.json(
      { error: "An error occurred while extracting content" },
      { status: 500 }
    );
  }
}
