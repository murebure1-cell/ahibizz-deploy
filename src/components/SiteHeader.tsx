"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { IS_PLAY_EDITION } from "../lib/distribution";
import {
  type HeaderAccess,
  type HeaderAccessRequest,
  headerAccessRequest,
} from "../lib/header-access";
import {
  headerCurrentDestination,
  headerDestinations,
  type NavigationDestination,
} from "../lib/header-navigation";
import { Icon } from "./Icon";
import { useOptionalAppPwa } from "./pwa/AppPwa";

const accessLinks = [
  { href: "/prijava", label: "Prijava" },
  { href: "/registracija", label: "Napravi nalog" },
];

export function SiteHeader({
  request = headerAccessRequest,
  supportAvailable = false,
}: {
  request?: HeaderAccessRequest;
  supportAvailable?: boolean;
}) {
  const pathname = usePathname();
  const installed = useOptionalAppPwa()?.installed ?? true;
  const [open, setOpen] = useState(false);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [access, setAccess] = useState<HeaderAccess>("unknown");
  const [refresh, setRefresh] = useState(0);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const previousPath = useRef(pathname);
  const clearAccess = useCallback(() => {
    revision.current++;
    controller.current?.abort();
    controller.current = null;
    setAccess("unknown");
  }, []);
  const closeMenu = useCallback(() => {
    clearAccess();
    setOpen(false);
  }, [clearAccess]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    closeMenu();
  }, [pathname, closeMenu]);

  useEffect(() => {
    const revalidate = () => {
      clearAccess();
      if (document.visibilityState !== "hidden") setRefresh((value) => value + 1);
    };
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    window.addEventListener("popstate", closeMenu);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      window.removeEventListener("popstate", closeMenu);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [clearAccess, closeMenu]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh revalidates an open menu after a browser/session boundary.
  useEffect(() => {
    clearAccess();
    if (
      !open ||
      pathname === "/pregled" ||
      pathname.startsWith("/pregled/") ||
      document.visibilityState === "hidden"
    )
      return;
    const current = revision.current;
    const read = new AbortController();
    controller.current = read;
    void request({ signal: read.signal })
      .then((next) => {
        if (!read.signal.aborted && current === revision.current)
          setAccess(next === "guest" || next === "member" || next === "owner" ? next : "unknown");
      })
      .catch(() => {
        if (!read.signal.aborted && current === revision.current) setAccess("unknown");
      });
    return () => {
      read.abort();
      if (controller.current === read) controller.current = null;
    };
  }, [open, pathname, request, clearAccess, refresh]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        toggle.current?.focus();
      }
    };
    const onOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) closeMenu();
    };
    window.addEventListener("keydown", onEscape);
    window.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open, closeMenu]);
  const { primary, more } = headerDestinations(access, {
    installed,
    playEdition: IS_PLAY_EDITION,
    supportAvailable,
  });
  function destination(link: NavigationDestination) {
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={currentHref === link.href ? "page" : undefined}
        data-design="app-menu-item"
        onClick={closeMenu}
      >
        <Icon name={link.icon} />
        {link.label}
      </Link>
    );
  }

  return (
    <header ref={header} className="site-header" data-design="app-header">
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label="AhiBizz — početna" onClick={closeMenu}>
          {/* The supplied SVG is a complete wordmark with its own aspect ratio. */}
          <Image
            src="/brand/ahi-logo-color.svg"
            alt="AhiBizz"
            width={178}
            height={48}
            unoptimized
          />
        </Link>
        <button
          ref={toggle}
          className="menu-toggle"
          data-design="app-toggle"
          type="button"
          aria-label={open ? "Zatvori meni" : "Otvori meni"}
          aria-expanded={open}
          aria-controls="site-navigation"
          onClick={() => {
            clearAccess();
            if (!open) {
              setCurrentHref(
                headerCurrentDestination(pathname, new URLSearchParams(window.location.search)),
              );
            }
            setOpen(!open);
          }}
        >
          <Icon name={open ? "close" : "menu"} />
        </button>
        <nav
          id="site-navigation"
          data-design="app-menu"
          className="header-menu"
          aria-label="Glavna navigacija"
          hidden={!open}
        >
          {primary.map(destination)}
          {access === "owner" &&
            destination({ href: "/administracija", label: "Administracija", icon: "shield" })}
          <details className="header-more" key={open ? "open" : "closed"}>
            <summary>
              Više
              <Icon name="chevron" />
            </summary>
            {more.map(destination)}
          </details>
          {access === "guest" && (
            <div className="header-access">
              {accessLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={currentHref === link.href ? "page" : undefined}
                  data-design="app-menu-item"
                  onClick={closeMenu}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
