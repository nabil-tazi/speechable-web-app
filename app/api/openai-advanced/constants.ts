export const LEVEL_PROMPT = [
  // LEVEL 0: ORIGINAL
  `TASK: Clean PDF text for TTS while replicating exact content sentence by sentence.

SECTION INFO:
- Title: "{SECTION_TITLE}"

CLEAN-UP RULES:
• Remove: academic references, (e. g., Knebel and others, 2011)
• Remove page numbers, headers, footers, table formatting artifacts, anything that isn't part of the document content.
• Fix: OCR errors, spacing issues
• Add periods after: titles, headings, standalone phrases (for TTS pausing)
• Capitalize only true acronyms (NASA, FBI) → normalize emphasis words (IMPORTANT → Important)
• Fix punctuation for speech flow
• REPLICATE: every sentence exactly as written - zero content changes

OUTPUT: Return ONLY the cleaned text content. No JSON, no formatting, just the processed text.

Process ONLY content between boundaries. Reproduce every sentence exactly.`,

  // LEVEL 1: NATURAL
  "",

  // LEVEL 2: LECTURE
  "",

  // LEVEL 3: CONVERSATIONAL
  "",
];
