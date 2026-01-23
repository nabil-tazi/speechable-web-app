import { NextResponse } from "next/server";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

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

function parseHtmlToSections(html: string): { sections: ProcessedSection[] } {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const sections: ProcessedSection[] = [];
  let currentSection: ProcessedSection | null = null;

  // Query block-level elements in document order
  const elements = Array.from(
    doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, div")
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

    // Parse with JSDOM and extract with Readability
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
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
