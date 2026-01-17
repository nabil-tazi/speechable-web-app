/**
 * Debug script for section detection
 * Usage: npx tsx scripts/debug-section-detection.ts <path-to-pdf>
 */

import * as fs from 'fs';
import * as path from 'path';

async function debugSectionDetection(pdfPath: string) {
  const mupdf = await import('mupdf');

  // Read the PDF
  const pdfBuffer = fs.readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');

  const numPages = doc.countPages();
  console.log(`\n=== PDF: ${path.basename(pdfPath)} ===`);
  console.log(`Pages: ${numPages}\n`);

  // Collect all font sizes to find dominant
  const fontSizeCounts = new Map<number, number>();
  const fontWeightCounts = new Map<string, number>();
  const allLines: Array<{
    page: number;
    block: number;
    line: number;
    text: string;
    fontSize: number;
    fontWeight: string;
    fontName: string;
  }> = [];

  for (let pageNum = 0; pageNum < Math.min(numPages, 10); pageNum++) {
    const page = doc.loadPage(pageNum);
    const sText = page.toStructuredText('preserve-whitespace,preserve-spans');
    const json = JSON.parse(sText.asJSON());

    for (let blockIdx = 0; blockIdx < json.blocks.length; blockIdx++) {
      const block = json.blocks[blockIdx];
      if (block.type !== 'text' || !block.lines) continue;

      for (let lineIdx = 0; lineIdx < block.lines.length; lineIdx++) {
        const line = block.lines[lineIdx];
        const text = line.text?.trim() || '';
        if (!text || text.length < 2) continue;

        const fontSize = Math.round(line.font?.size || 12);
        const fontWeight = line.font?.weight || 'normal';
        const fontName = line.font?.name || 'unknown';

        fontSizeCounts.set(fontSize, (fontSizeCounts.get(fontSize) || 0) + 1);
        fontWeightCounts.set(fontWeight, (fontWeightCounts.get(fontWeight) || 0) + 1);

        allLines.push({
          page: pageNum + 1,
          block: blockIdx,
          line: lineIdx,
          text: text.slice(0, 80) + (text.length > 80 ? '...' : ''),
          fontSize,
          fontWeight,
          fontName,
        });
      }
    }
  }

  // Find dominant (body text) font size
  let dominantSize = 12;
  let maxCount = 0;
  for (const [size, count] of fontSizeCounts) {
    if (size >= 8 && count > maxCount) {
      maxCount = count;
      dominantSize = size;
    }
  }

  // Find dominant font weight
  let dominantWeight = 'normal';
  maxCount = 0;
  for (const [weight, count] of fontWeightCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantWeight = weight;
    }
  }

  console.log('=== FONT ANALYSIS ===');
  console.log('\nFont size distribution:');
  const sortedSizes = [...fontSizeCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [size, count] of sortedSizes.slice(0, 10)) {
    const isBody = size === dominantSize;
    console.log(`  ${size}pt: ${count} lines${isBody ? ' [BODY TEXT]' : ''}`);
  }

  console.log(`\nDominant (body) font: ${dominantSize}pt, ${dominantWeight}`);
  console.log(`Heading threshold (1.1x): ${(dominantSize * 1.1).toFixed(1)}pt`);

  // Find potential headings
  console.log('\n=== POTENTIAL HEADINGS ===');
  console.log('(Lines that differ from body text)\n');

  const headingCandidates = allLines.filter(line => {
    const sizeRatio = line.fontSize / dominantSize;
    const isLarger = sizeRatio >= 1.1;
    const isBold = line.fontWeight === 'bold' && dominantWeight !== 'bold';
    const isDifferent = line.fontSize !== dominantSize || line.fontWeight !== dominantWeight;
    return isDifferent || isLarger || isBold;
  });

  // Group by font characteristics
  const byFont = new Map<string, typeof headingCandidates>();
  for (const line of headingCandidates) {
    const key = `${line.fontSize}pt-${line.fontWeight}`;
    if (!byFont.has(key)) byFont.set(key, []);
    byFont.get(key)!.push(line);
  }

  console.log('Grouped by font style:');
  const sortedFonts = [...byFont.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [font, lines] of sortedFonts) {
    const ratio = (parseInt(font) / dominantSize).toFixed(2);
    console.log(`\n${font} (${ratio}x body) - ${lines.length} lines:`);
    for (const line of lines.slice(0, 10)) {
      console.log(`  p.${line.page} b${line.block}: "${line.text}"`);
    }
    if (lines.length > 10) {
      console.log(`  ... and ${lines.length - 10} more`);
    }
  }

  // Show lines that match body text exactly (to check if headings are being missed)
  console.log('\n=== BODY TEXT SAMPLES ===');
  console.log(`(Lines with exact body font: ${dominantSize}pt, ${dominantWeight})\n`);

  const bodyLines = allLines.filter(line =>
    line.fontSize === dominantSize && line.fontWeight === dominantWeight
  );

  // Show first 20 body text lines
  for (const line of bodyLines.slice(0, 20)) {
    console.log(`  p.${line.page}: "${line.text}"`);
  }

  // Check for headings that might be the same size as body
  console.log('\n=== SAME-SIZE POTENTIAL HEADINGS ===');
  console.log('(Short lines with body font size that could be headings)\n');

  const sameSizeHeadings = allLines.filter(line => {
    if (line.fontSize !== dominantSize) return false;
    if (line.text.length > 60) return false; // Too long
    if (line.text.endsWith('.')) return false; // Ends with period
    // Check for numbered pattern
    if (/^\d+\.?\d*\.?\s/.test(line.text)) return true;
    // Check for all caps
    if (line.text === line.text.toUpperCase() && line.text.length > 3) return true;
    // Check if bold but body is normal
    if (line.fontWeight === 'bold' && dominantWeight === 'normal') return true;
    return false;
  });

  for (const line of sameSizeHeadings.slice(0, 20)) {
    console.log(`  p.${line.page}: [${line.fontSize}pt ${line.fontWeight}] "${line.text}"`);
  }

  console.log('\n=== END DEBUG ===\n');
}

// Run
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.log('Usage: npx tsx scripts/debug-section-detection.ts <path-to-pdf>');
  process.exit(1);
}

debugSectionDetection(pdfPath).catch(console.error);
