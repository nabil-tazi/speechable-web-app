/**
 * Gets text content from a container node, walking the DOM the same way
 * as cursor position calculation to ensure consistency.
 * BR elements are treated as newline characters.
 */
export function getTextContent(container: Node): string {
  let text = "";
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.nodeName === "BR") return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    }
  );

  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
    } else if (node.nodeName === "BR") {
      text += "\n";
    }
    node = walker.nextNode();
  }
  return text;
}
