"use client";

import { createContext, useContext, RefObject } from "react";

/**
 * AppShell's content overlay (`overflow-y-auto`) is the real scroll container — the
 * shell itself is `h-dvh overflow-hidden`, so `window` never scrolls. framer-motion's
 * `useScroll()` defaults to tracking `window`, which would silently freeze every
 * scroll-linked value in the Blue Hour scroll story. Scene components must pass this
 * ref as `useScroll`'s `container` option instead.
 */
export const ScrollContainerContext = createContext<RefObject<HTMLDivElement | null> | null>(
  null,
);

export const useScrollContainer = () => useContext(ScrollContainerContext);
