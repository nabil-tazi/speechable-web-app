/**
 * Test script for MuPDF.js processing
 *
 * Usage: npx tsx scripts/test-mupdf.ts <path-to-pdf>
 *
 * Example: npx tsx scripts/test-mupdf.ts ~/Documents/sample.pdf
 */

import * as fs from "fs";
import * as path from "path";

async function testMuPDF(filePath: string) {
  // Dynamic import MuPDF
  const mupdf = await import("mupdf");

  console.log("📄 Testing MuPDF.js processing\n");
  console.log(`File: ${filePath}\n`);

  // Read file
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ File not found: ${absolutePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(absolutePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );

  // Open document
  const doc = mupdf.Document.openDocument(arrayBuffer, "application/pdf");

  const numPages = doc.countPages();
  console.log(`📖 Pages: ${numPages}\n`);

  // Get metadata
  console.log("📋 Metadata:");
  console.log(`   Title: ${doc.getMetaData(mupdf.Document.META_INFO_TITLE) || "(none)"}`);
  console.log(`   Author: ${doc.getMetaData(mupdf.Document.META_INFO_AUTHOR) || "(none)"}`);
  console.log(`   Creator: ${doc.getMetaData(mupdf.Document.META_INFO_CREATOR) || "(none)"}`);
  console.log();

  // Process first page
  console.log("📝 First Page Structured Text:\n");

  const page = doc.loadPage(0);
  const bounds = page.getBounds();
  console.log(`   Page size: ${Math.round(bounds[2] - bounds[0])} x ${Math.round(bounds[3] - bounds[1])}\n`);

  const sText = page.toStructuredText("preserve-whitespace");
  const jsonStr = sText.asJSON();
  const structuredText = JSON.parse(jsonStr);

  // Analyze blocks
  let totalLines = 0;
  let fontSizes: number[] = [];

  console.log("   Blocks found:", structuredText.blocks.length);

  for (const block of structuredText.blocks) {
    if (block.lines) {
      totalLines += block.lines.length;
      for (const line of block.lines) {
        if (line.spans) {
          for (const span of line.spans) {
            if (span.size) fontSizes.push(span.size);
          }
        }
      }
    }
  }

  console.log(`   Lines found: ${totalLines}`);

  if (fontSizes.length > 0) {
    const avgFontSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;
    const maxFontSize = Math.max(...fontSizes);
    const minFontSize = Math.min(...fontSizes);
    console.log(`   Font sizes: min=${minFontSize.toFixed(1)}, avg=${avgFontSize.toFixed(1)}, max=${maxFontSize.toFixed(1)}`);
  }

  // Extract and display sample text
  console.log("\n📄 Sample Text (first 500 chars):\n");

  let extractedText = "";
  for (const block of structuredText.blocks) {
    if (block.lines) {
      for (const line of block.lines) {
        if (line.spans) {
          for (const span of line.spans) {
            if (span.chars) {
              extractedText += span.chars.map((c: any) => c.c).join("");
            }
          }
        }
        extractedText += "\n";
      }
      extractedText += "\n";
    }
  }

  console.log("---");
  console.log(extractedText.slice(0, 500));
  console.log("---\n");

  // Show JSON structure sample
  console.log("🔍 JSON Structure Sample (first block):\n");
  if (structuredText.blocks.length > 0) {
    const sampleBlock = structuredText.blocks[0];
    console.log(JSON.stringify(sampleBlock, null, 2).slice(0, 1000));
    if (JSON.stringify(sampleBlock).length > 1000) {
      console.log("... (truncated)");
    }
  }

  console.log("\n✅ MuPDF.js is working correctly!");
}

// Get file path from command line
const filePath = process.argv[2];
if (!filePath) {
  console.log("Usage: npx tsx scripts/test-mupdf.ts <path-to-pdf>");
  console.log("Example: npx tsx scripts/test-mupdf.ts ~/Documents/sample.pdf");
  process.exit(1);
}

testMuPDF(filePath).catch(console.error);
