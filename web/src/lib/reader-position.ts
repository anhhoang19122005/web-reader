// Offsets are UTF-16, exactly like plainText, bookmarks and the TTS API.
export function characterRange(container: HTMLElement, position: number) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, position);
  let node: Node | null;
  let last: Node | null = null;
  while ((node = walker.nextNode())) {
    last = node;
    const length = node.textContent?.length ?? 0;
    if (remaining < length) {
      const range = document.createRange();
      range.setStart(node, remaining); range.setEnd(node, Math.min(length, remaining + 1));
      return range;
    }
    remaining -= length;
  }
  if (!last) return null;
  const range = document.createRange();
  range.setStart(last, Math.max(0, (last.textContent?.length ?? 1) - 1)); range.setEnd(last, last.textContent?.length ?? 0);
  return range;
}

export function visibleCharacter(container: HTMLElement, top: number) {
  const paragraphs = Array.from(container.querySelectorAll<HTMLElement>("[data-start]"));
  const paragraph = paragraphs.find((node) => node.getBoundingClientRect().bottom > top) ?? paragraphs.at(-1);
  if (!paragraph) return 0;
  let low = Number(paragraph.dataset.start);
  let high = Number(paragraph.dataset.end);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const rect = characterRange(container, mid)?.getBoundingClientRect();
    if (!rect || !rect.height || rect.bottom <= top) low = mid + 1;
    else high = mid;
  }
  return Math.min(low, (container.textContent?.length ?? 1) - 1);
}

export function scrollToCharacter(container: HTMLElement, position: number, top: number) {
  const rect = characterRange(container, position)?.getBoundingClientRect();
  if (rect?.height) window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - top), behavior: "instant" });
}
