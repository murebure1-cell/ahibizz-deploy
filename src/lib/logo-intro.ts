/** Set once the opening animation has started on this device; it never plays twice. */
export const logoIntroStorageKey = "ahibizz.intro.v1";

/** How long the opening animation runs before it removes itself, in milliseconds. */
export const logoIntroDuration = 4500;

/**
 * Runs before the home page is painted and marks the document when the opening animation
 * should play: only on a device that has not seen it, and never for people who ask for less
 * motion. When storage cannot be read the animation stays off, because it could not be
 * remembered and would return on every visit.
 */
export const logoIntroBootstrap = `(()=>{try{if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;if(localStorage.getItem("${logoIntroStorageKey}")===null)document.documentElement.dataset.intro="play"}catch{}})();`;
