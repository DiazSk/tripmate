"use client";

import { useEffect, type RefObject } from "react";
import Lenis from "lenis";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/reducedMotion";

/**
 * The landing's scroll motion, as white-desert.com wires it: Lenis for the smooth scroll, driven
 * from GSAP's ticker with lag smoothing off, and every effect a scrubbed ScrollTrigger tween with
 * `ease: "none"` — the scroll position is the easing. Values are the reference's own, read from its
 * bundles; the canvas design "TripMate — Polar Landing" is the same code against `window`.
 *
 * **The scroller is AppShell's content overlay, not the window.** `.app-shell` is `h-dvh
 * overflow-hidden` and the document never scrolls (see `scrollContainer.ts`), so Lenis is built on
 * that element and its first child, and ScrollTrigger is told the same element as its scroller.
 *
 * **Smooth scroll exists only while the landing is mounted.** AppShell's note on the overlay says
 * its scrolling is native and compositor-owned on purpose, and on every other route it still is:
 * this Lenis is created on mount and destroyed on unmount, so the wizard, trips and the trip view
 * scroll exactly as before. Reduced motion skips all of it and the page is its finished layout.
 */
const DESKTOP = "(min-width: 769px)";

let lenis: Lenis | null = null;

const expoInOut = (t: number) =>
  t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;

/** Every in-page jump goes through here so it rides the smooth scroll instead of fighting it.
 *  `offset` is in pixels from the element's top; without Lenis a non-zero one centres it instead. */
export function scrollToTarget(el: Element | null, offset = 0) {
  if (!el) return;
  if (lenis) lenis.scrollTo(el as HTMLElement, { offset, duration: 1.4, easing: expoInOut });
  else el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: offset ? "center" : "start" });
}

export function useLandingMotion(
  root: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLDivElement | null> | null
) {
  useEffect(() => {
    const wrapper = scroller?.current;
    const page = root.current;
    if (!wrapper || !page || prefersReducedMotion()) return;
    const content = wrapper.firstElementChild as HTMLElement | null;
    if (!content) return;

    // The reference's root options: smooth wheel at Lenis' default lerp (0.1), touch synced too.
    // It also sets `touchInertiaExponent: 1.7`, an option of a later Lenis than the 1.3.4 pinned here.
    const instance = new Lenis({
      wrapper,
      content,
      autoRaf: false,
      anchors: { duration: 1.4, easing: expoInOut },
      syncTouch: true,
      syncTouchLerp: 0.075,
    });
    lenis = instance;
    instance.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => build(page, wrapper), page);
    // Photographs and the map settle their heights after first paint; re-measure once they have.
    const late = window.setTimeout(() => ScrollTrigger.refresh(), 1200);
    return () => {
      window.clearTimeout(late);
      ctx.revert();
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      instance.destroy();
      if (lenis === instance) lenis = null;
    };
  }, [root, scroller]);
}

function build(root: HTMLElement, scroller: HTMLElement) {
  const q = (s: string) => root.querySelector<HTMLElement>(s);
  const all = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
  const scrub = (trigger: Element, start: string, end: string) => ({
    trigger,
    scroller,
    start,
    end,
    scrub: true,
    invalidateOnRefresh: true,
  });

  // Hero — the reference's hero-banner: the photograph is carried down at exactly scroll speed, so
  // it holds still while the white intro rises over it like a curtain; it blurs to 10px and dims on
  // the way out. The monument is carried at 60% of scroll speed, so it reads as standing in front.
  const hero = q(".tm-hero");
  const media = q(".tm-hero-media");
  if (hero && media) {
    gsap.to(media, { yPercent: 100, ease: "none", scrollTrigger: scrub(hero, "top top", "bottom top") });
    gsap.fromTo(media, { filter: "blur(0px)" }, { filter: "blur(10px)", ease: "none", scrollTrigger: scrub(hero, "top top", "bottom top") });
    gsap.fromTo(q(".tm-hero-veil"), { opacity: 0 }, { opacity: 0.6, ease: "none", scrollTrigger: scrub(hero, "top top", "bottom top") });
    gsap.to(q(".tm-monument-wrap"), { y: () => hero.offsetHeight * 0.6, ease: "none", scrollTrigger: scrub(hero, "top top", "bottom top") });
    gsap.to(all(".tm-hero-mid, .tm-hero-foot"), { opacity: 0, y: "-3em", ease: "none", scrollTrigger: scrub(hero, "top top", "40% top") });
  }

  gsap.matchMedia().add(DESKTOP, () => {
    // Full-bleed sections arrive as an inset card and open to the edges (has-inset-effect).
    all(".tm-night, .tm-fb").forEach((el) => {
      gsap.fromTo(el, { clipPath: "inset(0 1.25rem 0 1.25rem round 0.375rem)" }, { clipPath: "inset(0 0rem 0 0rem round 0rem)", ease: "none", scrollTrigger: scrub(el, "top 80%", "top 50%") });
    });

    // The sample-plan strip widens from 10% each side as it comes up.
    const strip = q(".tm-strip");
    if (strip) gsap.fromTo(strip, { clipPath: "inset(0 10% 0 10% round 0.375rem)" }, { clipPath: "inset(0 0% 0 0% round 0.375rem)", ease: "none", scrollTrigger: scrub(strip, "top bottom", "top 35%") });

    // The four beats rise at four speeds and land level (data-from-y parallax, in em).
    const beats = q(".tm-beats");
    if (beats) {
      all(".tm-beat").forEach((el, i) => {
        gsap.fromTo(el, { y: `${(i + 1) * 3}em` }, { y: "0em", ease: "none", scrollTrigger: scrub(beats, "top bottom", "center 60%") });
      });
    }

    // Section titles drift against the scroll.
    all(".tm-section-title").forEach((el) => {
      gsap.fromTo(el, { y: "2.5em" }, { y: "-2.5em", ease: "none", scrollTrigger: scrub(el, "top bottom", "bottom top") });
    });

    // Footer: the photograph moves slower than the page, the monument rises into place last.
    const foot = q(".tm-fb");
    if (foot) {
      gsap.fromTo(q(".tm-fb-photo"), { yPercent: -8 }, { yPercent: 0, ease: "none", scrollTrigger: scrub(foot, "top bottom", "bottom bottom") });
      gsap.fromTo(q(".tm-fb-monument"), { yPercent: 45 }, { yPercent: 0, ease: "none", scrollTrigger: scrub(foot, "center bottom", "bottom bottom") });
    }
  });
}
