export type DocumentType =
  | "academic_paper"
  | "business_report"
  | "legal_document"
  | "technical_manual"
  | "book_chapter"
  | "news_article"
  | "general";

export const DOCUMENT_SPECIFIC_INSTRUCTIONS: Record<
  DocumentType,
  {
    analysis: string;
    specific_rules: Record<1 | 2 | 3 | 4, string>;
  }
> = {
  academic_paper: {
    analysis:
      "Dense technical content with citations, abstract, methodology sections",
    specific_rules: {
      1: "YOU MUST Remove the citation numbers [1], [2], ALL REFERENCES, article names and dates must be removed. Specifically skip any list of Author, article title, dates, at the end of the document.",
      2: 'Simplify methodology descriptions. Convert "et al." to "and others". Make technical terms more accessible.',
      3: "Focus on key findings and implications. Summarize methodology briefly. Explain significance in plain language.",
      4: "Host A (Alex) asks about research questions and significance. Host B (Blake) explains findings and real-world applications.",
    },
  },
  business_report: {
    analysis:
      "Structured content with executive summary, data tables, financial metrics",
    specific_rules: {
      1: "Remove table formatting. Convert financial figures to readable format ($1.2M instead of $1,200,000).",
      2: "Make data presentations flow naturally. Explain what metrics mean in context.",
      3: "Highlight key insights and actionable takeaways. Summarize detailed data sections.",
      4: "Host A (Alex) focuses on business implications. Host B (Blake) explains data and trends in accessible terms.",
    },
  },
  legal_document: {
    analysis: "Formal language with clauses, definitions, legal references",
    specific_rules: {
      1: "Keep legal precision but fix formatting. Convert section references to readable form.",
      2: "Simplify complex legal sentences while maintaining meaning. Explain legal terms when first used.",
      3: "Focus on key obligations and rights. Summarize lengthy clauses into main points.",
      4: "Host A (Alex) asks about practical implications. Host B (Blake) explains legal concepts in everyday terms.",
    },
  },
  technical_manual: {
    analysis:
      "Step-by-step instructions, technical specifications, troubleshooting guides",
    specific_rules: {
      1: "Preserve step numbers and sequence. Convert measurements and specifications to readable format.",
      2: "Make instructions flow conversationally. Add transition words between steps.",
      3: "Focus on essential steps and key safety information. Group related procedures.",
      4: "Host A (Alex) asks clarifying questions about procedures. Host B (Blake) walks through steps clearly.",
    },
  },
  book_chapter: {
    analysis: "Narrative or educational content with consistent style and flow",
    specific_rules: {
      1: "Remove chapter numbers and page references. Preserve author's voice and style.",
      2: "Enhance natural reading flow. Fix awkward transitions between paragraphs.",
      3: "Maintain narrative flow while condensing lengthy descriptions or explanations.",
      4: "Host A (Alex) asks engaging questions about themes. Host B (Blake) discusses content enthusiastically.",
    },
  },
  news_article: {
    analysis:
      "Journalistic content with headlines, bylines, quotes, and structured information",
    specific_rules: {
      1: "Remove bylines and publication info. Keep quotes but format naturally for speech.",
      2: "Make quotes flow naturally in speech. Convert news-style writing to conversational tone.",
      3: "Focus on key facts and implications. Summarize background information concisely.",
      4: "Host A (Alex) asks about newsworthiness and impact. Host B (Blake) explains events and context.",
    },
  },
  general: {
    analysis: "Mixed or unclear document type",
    specific_rules: {
      1: "Remove obvious formatting artifacts. Fix common OCR errors.",
      2: "Improve readability and flow for speech without major changes.",
      3: "Condense while preserving main ideas and important details.",
      4: "Host A (Alex) creates engaging dialogue. Host B (Blake) covers the main content conversationally.",
    },
  },
};
