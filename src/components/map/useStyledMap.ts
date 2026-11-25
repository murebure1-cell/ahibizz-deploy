"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { type MapStyleKind, mapGround, mapStyleKind, mapStyles } from "../../lib/google-maps";
import {
  type GoogleMap,
  type GoogleMapsApi,
  type LatLngLiteral,
  loadGoogleMaps,
  type MapsListener,
  onGoogleMapsAuthFailure,
  pageGoogleMapsKey,
} from "../../lib/google-maps-loader";
import { useI18n } from "../i18n/LocaleProvider";

function darkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

export type StyledMap = {
  /** "unavailable": no key on the page, the script did not load, or Google refused the key. */
  state: "loading" | "ready" | "unavailable";
  map: GoogleMap | null;
  maps: GoogleMapsApi | null;
};

/**
 * A Google map in the app's own colours, for both themes. `kind` "auto" shows countries from far
 * away and streets from close up; the two fixed kinds keep one look at every zoom. The options
 * are read once, when the map is made.
 */
export function useStyledMap(
  target: RefObject<HTMLElement | null>,
  options: {
    centre: LatLngLiteral;
    zoom: number;
    kind?: MapStyleKind | "auto";
    /** "greedy": one finger moves the map. "cooperative": the page scrolls, two fingers move it. */
    gesture?: "greedy" | "cooperative";
    minZoom?: number;
    maxZoom?: number;
  },
): StyledMap {
  const { locale } = useI18n();
  const [value, setValue] = useState<StyledMap>({ state: "loading", map: null, maps: null });
  const first = useRef(options);
  const language = useRef(locale);

  useEffect(() => {
    const key = pageGoogleMapsKey();
    if (!key) {
      setValue({ state: "unavailable", map: null, maps: null });
      return;
    }
    let cancelled = false;
    const listeners: MapsListener[] = [];
    let theme: MutationObserver | undefined;
    const fail = () => {
      if (!cancelled) setValue({ state: "unavailable", map: null, maps: null });
    };
    const stopAuth = onGoogleMapsAuthFailure(fail);
    loadGoogleMaps(key, language.current)
      .then((maps) => {
        const element = target.current;
        if (cancelled || !element) return;
        const {
          centre,
          zoom,
          kind = "streets",
          gesture = "greedy",
          minZoom,
          maxZoom,
        } = first.current;
        let shown: MapStyleKind = kind === "auto" ? mapStyleKind(zoom) : kind;
        const map = new maps.Map(element, {
          center: centre,
          zoom,
          styles: mapStyles(darkTheme(), shown),
          backgroundColor: mapGround(darkTheme(), shown),
          disableDefaultUI: true,
          keyboardShortcuts: false,
          clickableIcons: false,
          gestureHandling: gesture,
          ...(minZoom === undefined ? {} : { minZoom }),
          ...(maxZoom === undefined ? {} : { maxZoom }),
        });
        const restyle = () => map.setOptions({ styles: mapStyles(darkTheme(), shown) });
        if (kind === "auto")
          listeners.push(
            map.addListener("zoom_changed", () => {
              const next = mapStyleKind(map.getZoom());
              if (next === shown) return;
              shown = next;
              restyle();
            }),
          );
        theme = new MutationObserver(restyle);
        theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
        setValue({ state: "ready", map, maps });
      })
      .catch(fail);
    return () => {
      cancelled = true;
      stopAuth();
      theme?.disconnect();
      for (const listener of listeners) listener.remove();
    };
  }, [target]);

  return value;
}
