export async function identifySections(text: string): Promise<any> {
  //   setIsClassifying(true);
  //   setError(null);

  try {
    const response = await fetch("/api/identify-sections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `Section identification failed: ${response.status}`
      );
    }

    const data = await response.json();

    console.log("DOCUMENT SECTIONS");
    console.log(data);

    // setError(null);

    return data; // Return the classification object
  } catch (err) {
    console.error("Error identifying document sections:", err);
    // setError(
    //   err instanceof Error ? err.message : "Failed to identify sections"
    // );
    return null; // Return null on error
  } finally {
    // setIsClassifying(false);
  }
}
