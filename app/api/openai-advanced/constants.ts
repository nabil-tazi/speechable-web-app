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
  `Transform this text into a natural conversation format suitable for text-to-speech.

Create an engaging dialogue between EXACTLY 2 speakers that makes the content accessible and interesting to listen to:

SPEAKER ROLES:
- QUESTIONER (reader_id: "questioner"): Introduces the conversation, asks thoughtful questions, and guides the discussion. Helps the expert cover important issues, methods, problems, findings, and results by asking strategic questions. Keeps responses brief and focused on facilitating the expert's explanations.

- EXPERT (reader_id: "expert"): Provides extensive, detailed answers to the questioner's inquiries. Can give longer, comprehensive responses that thoroughly explain concepts, data, methods, and findings. Should cover all the substantive content from the original text.

CONVERSATION FLOW:
- MUST alternate between questioner and expert - no consecutive speeches from the same speaker
- Questioner asks questions or makes brief comments to guide the conversation
- Expert provides detailed, informative responses
- Expert can have longer speeches (multiple sentences/paragraphs) while questioner keeps contributions shorter
- Ensure natural back-and-forth rhythm throughout


Guidelines:
- Use natural, conversational language with appropriate transitions
- Ensure STRICT alternation between speakers (questioner → expert → questioner → expert)
- Include ALL content from the original text through the expert's responses
- Do not omit any important information, concepts, data, examples, or specific details
- Questioner should ask about key topics, methods, problems, findings, and results
- Expert should provide comprehensive explanations covering all source material`,
];

// Return ONLY a JSON object in this exact format:
// {
//   "dialogue": [
//     {
//       "text": "Speaker's dialogue here, no markups as it will be read as it is by TTS",
//       "reader_id": "questioner" or "expert"
//     },
//   ]
// }
