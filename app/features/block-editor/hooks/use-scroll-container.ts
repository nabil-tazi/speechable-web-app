import { useCallback, useEffect, useRef, useState } from "react";

interface UseScrollContainerOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isMenuVisible: boolean;
}

interface UseScrollContainerReturn {
  getScrollContainer: () => HTMLElement | null;
  scrollToTarget: () => void;
  isScrolledAway: boolean;
  originalScrollPosRef: React.MutableRefObject<number>;
  keepMenuVisibleRef: React.MutableRefObject<boolean>;
}

/**
 * Hook for managing scroll container detection and scroll-to-target functionality.
 */
export function useScrollContainer({
  containerRef,
  isMenuVisible,
}: UseScrollContainerOptions): UseScrollContainerReturn {
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const originalScrollPosRef = useRef<number>(0);
  const keepMenuVisibleRef = useRef<boolean>(false);
  const [isScrolledAway, setIsScrolledAway] = useState(false);

  // Find the scrollable parent container
  const getScrollContainer = useCallback(() => {
    if (scrollContainerRef.current) return scrollContainerRef.current;
    // Find the overflow-auto container (from layout.tsx)
    let element = containerRef.current?.parentElement;
    while (element) {
      const style = getComputedStyle(element);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        scrollContainerRef.current = element;
        return element;
      }
      element = element.parentElement;
    }
    return null;
  }, [containerRef]);

  // Scroll to the original text position
  const scrollToTarget = useCallback(() => {
    // Keep menu visible - it will only hide when user clicks elsewhere or takes an action
    keepMenuVisibleRef.current = true;

    const container = getScrollContainer();
    if (container) {
      container.scrollTo({
        top: originalScrollPosRef.current,
        behavior: "smooth",
      });
    }
  }, [getScrollContainer]);

  // Track scroll position to enable/disable focus button
  useEffect(() => {
    const container = getScrollContainer();
    if (!container || !isMenuVisible) return;

    const handleScroll = () => {
      const currentScroll = container.scrollTop;
      const threshold = 50; // Consider "scrolled away" if more than 50px from original
      setIsScrolledAway(
        Math.abs(currentScroll - originalScrollPosRef.current) > threshold
      );
    };

    // Check initial state
    handleScroll();

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [getScrollContainer, isMenuVisible]);

  return {
    getScrollContainer,
    scrollToTarget,
    isScrolledAway,
    originalScrollPosRef,
    keepMenuVisibleRef,
  };
}
