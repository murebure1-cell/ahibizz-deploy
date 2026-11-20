"use client";
import { useEffect, useRef, useState } from "react";
import {
  defaultVisualDesign,
  designCss,
  designProperties,
  designTargets,
  findDesignTarget,
  parseVisualDesign,
} from "../../lib/visual-design";
import { PreviewStateProvider } from "../preview/PreviewState";
import { SiteHeader } from "../SiteHeader";
import { SimulatorScreens } from "./SimulatorScreens";
import { type FrameState, frameChannel, isScreen, screenForPath } from "./simulator";

const guest = async () => "member" as const;
function tellParent(type: string, data: Record<string, unknown> = {}) {
  if (window.parent !== window)
    window.parent.postMessage({ channel: frameChannel, type, ...data }, location.origin);
}
function previewMenuTarget(id: string) {
  return id === "app-menu" || id === "app-menu-item";
}
function reportComputedStyle(element: Element, id: string) {
  const css = getComputedStyle(element);
  const values = Object.fromEntries(
    designProperties.map(({ name }) => [name, css.getPropertyValue(name)]),
  );
  tellParent("computed", { id, values });
}
export function DesignPreview() {
  const [state, setState] = useState<FrameState>(() => ({
    design: defaultVisualDesign(),
    screen: "home",
    dark: false,
    inspect: true,
    selected: "home-hero",
  }));
  const [connected, setConnected] = useState(false);
  const previousTarget = useRef("");
  const picked = useRef<{ id: string; element: Element } | null>(null);
  const outline = useRef<Element | null>(null);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        window.parent === window ||
        event.source !== window.parent ||
        event.origin !== location.origin
      )
        return;
      const data = event.data;
      if (
        data?.channel !== frameChannel ||
        data.type !== "update" ||
        !isScreen(data.screen) ||
        typeof data.inspect !== "boolean" ||
        typeof data.dark !== "boolean" ||
        !designTargets.some((t) => t.id === data.selected)
      )
        return;
      try {
        setState({
          design: parseVisualDesign(data.design),
          screen: data.screen,
          dark: data.dark,
          inspect: data.inspect,
          selected: data.selected,
        });
        setConnected(true);
      } catch {}
    }
    window.addEventListener("message", receive);
    tellParent("ready");
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? "dark" : "light";
    document.documentElement.style.colorScheme = state.dark ? "dark" : "light";
  }, [state.dark]);
  useEffect(() => {
    const prevent = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    function click(event: Event) {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (state.inspect) {
        prevent(event);
        const content = document.getElementById("simulator-content");
        const selected = content && findDesignTarget(event.target, content);
        if (selected) {
          const id = selected.target.id;
          picked.current = { id, element: selected.element };
          outline.current?.removeAttribute("data-design-inspected");
          selected.element.setAttribute("data-design-inspected", "");
          outline.current = selected.element;
          tellParent("select", { id });
          reportComputedStyle(selected.element, id);
        }
        return;
      }
      if (link) {
        prevent(event);
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin) return;
        if (url.pathname === location.pathname && url.hash)
          document.getElementById(url.hash.slice(1))?.scrollIntoView();
        else {
          const next = screenForPath(url);
          if (next) tellParent("navigate", { screen: next });
        }
        return;
      }
      if (event.target.closest("input[type=file],button[type=submit]")) {
        const search = event.target.closest('form[action*="pretraga"]');
        prevent(event);
        if (search) tellParent("navigate", { screen: "search" });
      }
    }
    function submit(event: Event) {
      prevent(event);
      if (
        !state.inspect &&
        event.target instanceof HTMLFormElement &&
        event.target.action.includes("/pretraga")
      )
        tellParent("navigate", { screen: "search" });
    }
    function context(event: Event) {
      if (event.target instanceof Element && event.target.closest("a[href]")) prevent(event);
    }
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    document.addEventListener("auxclick", context, true);
    document.addEventListener("contextmenu", context, true);
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
      document.removeEventListener("auxclick", context, true);
      document.removeEventListener("contextmenu", context, true);
    };
  }, [state.inspect]);
  useEffect(() => {
    if (!connected) return;
    const chosen = designTargets.find((t) => t.id === state.selected);
    if (!chosen) return;
    const content = document.querySelector("#simulator-content");
    if (!content) return;
    const targetKey = `${state.screen}-${state.selected}`;
    let timer = 0;
    function measure() {
      if (!chosen) return;
      const clicked = picked.current?.id === chosen.id ? picked.current.element : null;
      const element =
        clicked?.isConnected && clicked.getClientRects().length
          ? clicked
          : Array.from(content?.querySelectorAll(chosen.selector) ?? []).find(
              (match) => match.getClientRects().length,
            );
      if (!element) return;
      outline.current?.removeAttribute("data-design-inspected");
      if (state.inspect) {
        element.setAttribute("data-design-inspected", "");
        outline.current = element;
      }
      if (state.inspect && previousTarget.current !== targetKey) {
        element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        previousTarget.current = targetKey;
      }
      reportComputedStyle(element, chosen.id);
    }
    function schedule() {
      cancelAnimationFrame(timer);
      timer = requestAnimationFrame(measure);
    }
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(content, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(timer);
      outline.current?.removeAttribute("data-design-inspected");
    };
  }, [state, connected]);
  const target = designTargets.find((t) => t.id === state.selected);
  return (
    <div id="simulator-content">
      <style>{designCss(state.design)}</style>
      {state.inspect && target && (
        <style>
          {"[data-design-inspected]{outline:2px solid #3587b0!important;outline-offset:-2px;scroll-margin-top:78px} #simulator-content :is(main,main *,[data-design]):hover{cursor:crosshair}" +
            (previewMenuTarget(target.id) ? "#site-navigation[hidden]{display:grid}" : "")}
        </style>
      )}
      <SiteHeader key={state.screen} request={guest} />
      <PreviewStateProvider>
        <SimulatorScreens key={state.screen} screen={state.screen} design={state.design} />
      </PreviewStateProvider>
    </div>
  );
}
