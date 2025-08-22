type CleanTextWithOpenAiInput = {
  rawInputText: string;
  processingLevel: 0 | 1 | 2 | 3;
  retryCount?: number;
};

export async function cleanTextWithOpenAI({
  rawInputText,
  processingLevel,
  retryCount = 0,
}: CleanTextWithOpenAiInput) {
  const maxRetries = 2;
  //   setIsCleaningText(true);
  //   setError(null);

  try {
    const response = await fetch("/api/openai-advanced", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: rawInputText,
        level: processingLevel,
        // documentType: classification?.documentType,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Handle specific error codes (same as original)
      if (
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504
      ) {
        if (retryCount < maxRetries) {
          //   setError(
          //     `Server temporarily unavailable, retrying... (${retryCount + 1}/${
          //       maxRetries + 1
          //     })`
          //   );
          await new Promise((resolve) =>
            setTimeout(resolve, (retryCount + 1) * 1000)
          );
          return cleanTextWithOpenAI({
            rawInputText,
            processingLevel,
            retryCount: retryCount + 1,
          });
        } else {
          throw new Error(
            "OpenAI service is temporarily unavailable. Please try again in a few minutes."
          );
        }
      } else if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment and try again."
        );
      } else if (response.status === 401) {
        throw new Error(
          "Authentication failed. Please check your API configuration."
        );
      } else if (response.status >= 400 && response.status < 500) {
        throw new Error(
          errorData.error ||
            `Request failed (${response.status}). Please check your input and try again.`
        );
      } else {
        throw new Error(
          errorData.error || `OpenAI API error: ${response.status}`
        );
      }
    }

    const data = await response.json();

    return {
      cleanedText: data.message,
      metadata: data.metadata,
    };
  } catch (err) {
    console.error("Error processing text:", err);

    // if (err instanceof TypeError && err.message.includes("fetch")) {
    //   setError("Network error. Please check your connection and try again.");
    // } else if (err instanceof Error) {
    //   setError(err.message);
    // } else {
    //   setError("Failed to process text with AI. Please try again.");
    // }

    throw err; // Re-throw so startProcessing can handle it
  } finally {
    // setIsCleaningText(false);
  }
}
