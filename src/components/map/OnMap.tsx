"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type GoogleMap,
  type GoogleMapsApi,
  type HtmlMarker,
  htmlMarker,
} from "../../lib/google-maps-loader";

/**
 * Draws its children at a place on a Google map, as ordinary markup with the app's own styles.
 * The press is heard on the holder itself, because the map decides for itself which of the
 * touches inside it travel further up the page.
 */
export function OnMap({
  map,
  maps,
  latitude,
  longitude,
  layer = "pins",
  order,
  onPress,
  children,
}: {
  map: GoogleMap;
  maps: GoogleMapsApi;
  latitude: number;
  longitude: number;
  layer?: "pins" | "float";
  /** Which of two marks at nearly the same place lies on top. */
  order?: number;
  onPress?: () => void;
  children: ReactNode;
}) {
  const [holder] = useState(() => document.createElement("div"));
  const marker = useRef<HtmlMarker | null>(null);
  const press = useRef(onPress);
  press.current = onPress;
  const first = useRef({ lat: latitude, lng: longitude });

  useEffect(() => {
    const created = htmlMarker(maps, holder, first.current, layer);
    created.setMap(map);
    marker.current = created;
    const pressed = (event: Event) => {
      if (!press.current) return;
      event.stopPropagation();
      press.current();
    };
    holder.addEventListener("click", pressed);
    return () => {
      holder.removeEventListener("click", pressed);
      created.setMap(null);
      marker.current = null;
    };
  }, [map, maps, holder, layer]);

  useEffect(() => {
    first.current = { lat: latitude, lng: longitude };
    marker.current?.setPosition(first.current);
  }, [latitude, longitude]);

  useEffect(() => {
    holder.style.zIndex = order === undefined ? "" : String(order);
  }, [holder, order]);

  return createPortal(children, holder);
}
