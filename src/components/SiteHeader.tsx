"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type HeaderAccess,
  type HeaderAccessRequest,
  headerAccessRequest,
} from "../lib/header-access";
import { Icon } from "./Icon";

const links = [
  { href: "/", label: "Početna" },
  { href: "/pretraga", label: "Istraži djelatnosti" },
  { href: "/ljudi", label: "Ljudi" },
  { href: "/nalog?odjeljak=poruke", label: "Poruke" },
  { href: "/nalog", label: "Moj nalog" },
  { href: "/paketi", label: "Paketi" },
  { href: "/o-nama", label: "O AhiBizzu" },
  { href: "/instaliraj", label: "Instaliraj AhiBizz" },
];
const accessLinks = [
  { href: "/prijava", label: "Prijava" },
  { href: "/registracija", label: "Napravi nalog" },
];

export function SiteHeader({ request = headerAccessRequest }: { request?: HeaderAccessRequest }) {
  const pathname = usePathname();
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
    const onOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) closeMenu();
    };
    window.addEventListener("keydown", onEscape);
    window.addEventListener("pointerdown", onOutside);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("pointerdown", onOutside);
    };
  }, [open, closeMenu]);

  return (
    <header ref={header} className="site-header">
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
          type="button"
          aria-label={open ? "Zatvori meni" : "Otvori meni"}
          aria-expanded={open}
          aria-controls="site-navigation"
          onClick={() => {
            clearAccess();
            if (!open) {
              const query = new URLSearchParams(window.location.search);
              setCurrentHref(
                pathname === "/nalog" &&
                  query.getAll("odjeljak").length === 1 &&
                  query.get("odjeljak") === "poruke"
                  ? "/nalog?odjeljak=poruke"
                  : pathname,
              );
            }
            setOpen(!open);
          }}
        >
          <Icon name={open ? "close" : "menu"} />
        </button>
        <nav
          id="site-navigation"
          className="header-menu"
          aria-label="Glavna navigacija"
          hidden={!open}
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={currentHref === link.href ? "page" : undefined}
              onClick={closeMenu}
            >
              {link.label}
              <Icon name="arrow" />
            </Link>
          ))}
          {access === "owner" && (
            <Link
              href="/administracija"
              aria-current={currentHref === "/administracija" ? "page" : undefined}
              onClick={closeMenu}
            >
              Administracija
              <Icon name="arrow" />
            </Link>
          )}
          {access === "guest" && (
            <div className="header-access">
              {accessLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={currentHref === link.href ? "page" : undefined}
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
