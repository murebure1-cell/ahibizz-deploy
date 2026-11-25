"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IS_PLAY_EDITION } from "../lib/distribution";
import {
  type HeaderAccess,
  type HeaderAccessRequest,
  type HeaderMenuAccount,
  headerMenuRequest,
} from "../lib/header-access";
import {
  headerCurrentDestination,
  headerDestinations,
  type NavigationDestination,
} from "../lib/header-navigation";
import { msg } from "../lib/i18n/translate";
import { AccountMenuFooter, AccountQuickMenu } from "./account/AccountQuickMenu";
import { Icon } from "./Icon";
import { useT } from "./i18n/LocaleProvider";
import { useOptionalAppPwa } from "./pwa/AppPwa";

const accessLinks = [
  { href: "/prijava", label: msg("Prijava") },
  { href: "/registracija", label: msg("Napravi nalog") },
];

export function SiteHeader({
  supportAvailable = false,
  request,
}: {
  supportAvailable?: boolean;
  request?: HeaderAccessRequest;
}) {
  const t = useT();
  const pathname = usePathname();
  const installed = useOptionalAppPwa()?.installed ?? true;
  const [open, setOpen] = useState(false);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [summary, setSummary] = useState<HeaderMenuAccount | "guest" | "unknown" | "loading">(
    "loading",
  );
  const account = typeof summary === "object" ? summary : null;
  const loading = summary === "loading";
  const access: HeaderAccess = account?.role ?? (summary === "guest" ? "guest" : "unknown");
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null);
  const previousPath = useRef(pathname);
  const preview = pathname === "/pregled" || pathname.startsWith("/pregled/");
  const abortRead = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);
  const closeMenu = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (open && menu.current) menu.current.scrollTop = 0;
  }, [open]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    closeMenu();
  }, [pathname, closeMenu]);

  const readAccess = useCallback(() => {
    if (controller.current || preview || document.visibilityState === "hidden") return;
    const read = new AbortController();
    controller.current = read;
    setSummary((current) => (current === "unknown" ? "loading" : current));
    void (async () => {
      try {
        const options = { signal: read.signal };
        const next = request
          ? (await request(options)) === "guest"
            ? "guest"
            : "unknown"
          : await headerMenuRequest(options);
        if (!read.signal.aborted) setSummary(next);
      } catch {
        if (!read.signal.aborted) setSummary("unknown");
      } finally {
        if (controller.current === read) controller.current = null;
      }
    })();
  }, [preview, request]);

  useEffect(() => {
    const clearAccess = () => {
      abortRead();
      setSummary("loading");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") clearAccess();
      else readAccess();
    };
    const onRestore = (event: PageTransitionEvent) => {
      if (event.persisted) readAccess();
    };
    readAccess();
    window.addEventListener("blur", clearAccess);
    window.addEventListener("focus", readAccess);
    window.addEventListener("pagehide", clearAccess);
    window.addEventListener("pageshow", onRestore);
    window.addEventListener("popstate", closeMenu);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      abortRead();
      window.removeEventListener("blur", clearAccess);
      window.removeEventListener("focus", readAccess);
      window.removeEventListener("pagehide", clearAccess);
      window.removeEventListener("pageshow", onRestore);
      window.removeEventListener("popstate", closeMenu);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [abortRead, closeMenu, readAccess]);

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
  const { primary, business, more } = headerDestinations(access, {
    installed,
    playEdition: IS_PLAY_EDITION,
    supportAvailable,
  });
  function destination(link: NavigationDestination) {
    return (
      <Link
        key={link.href}
        href={link.href}
        prefetch={false}
        aria-current={currentHref === link.href ? "page" : undefined}
        data-design="app-menu-item"
        onClick={closeMenu}
      >
        <Icon name={link.icon} />
        {t(link.label)}
      </Link>
    );
  }

  return (
    <header ref={header} className="site-header" data-design="app-header">
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label={t("AhiBizz — početna")} onClick={closeMenu}>
          {/* The supplied SVG is a complete wordmark with its own aspect ratio. */}
          <Image
            src="/brand/ahi-logo-color.svg"
            alt="AhiBizz"
            width={178}
            height={48}
            unoptimized
            priority
          />
        </Link>
        <button
          ref={toggle}
          className="menu-toggle"
          data-design="app-toggle"
          type="button"
          aria-label={open ? t("Zatvori meni") : t("Otvori meni")}
          aria-expanded={open}
          aria-controls="site-navigation"
          onClick={() => {
            if (open) {
              closeMenu();
              return;
            }
            setCurrentHref(
              headerCurrentDestination(pathname, new URLSearchParams(window.location.search)),
            );
            setOpen(true);
            readAccess();
          }}
        >
          <Icon name={open ? "close" : "menu"} />
        </button>
        <nav
          ref={menu}
          id="site-navigation"
          data-design="app-menu"
          className="header-menu"
          aria-label={t("Glavna navigacija")}
          hidden={!open}
        >
          {loading && !preview && (
            <p className="header-menu-status" role="status">
              {t("Učitavamo nalog…")}
            </p>
          )}
          {account && (
            <AccountQuickMenu
              key={account.id}
              account={account}
              close={closeMenu}
              currentHref={currentHref}
            />
          )}
          {account ? (
            <details className="header-more" key={`explore-${open}`}>
              <summary>
                {t("Istraži AhiBizz")} <Icon name="chevron" />
              </summary>
              {primary.filter((link) => !link.href.startsWith("/nalog")).map(destination)}
            </details>
          ) : (
            primary.map(destination)
          )}
          {access === "owner" &&
            destination({ href: "/administracija", label: msg("Administracija"), icon: "shield" })}
          {business.length > 0 && (
            <details
              key={`business-${open}`}
              className="header-more"
              open={business.some((link) => link.href === currentHref)}
            >
              <summary>
                {t("Za djelatnosti")}
                <Icon name="chevron" />
              </summary>
              {business.map(destination)}
            </details>
          )}
          <details
            className="header-more"
            key={`info-${open}`}
            open={more.some((link) => link.href === currentHref)}
          >
            <summary>
              {t("O aplikaciji")}
              <Icon name="chevron" />
            </summary>
            {more.map(destination)}
          </details>
          {account && (
            <AccountMenuFooter key={`footer-${account.id}`} account={account} close={closeMenu} />
          )}
          {access === "guest" && (
            <div className="header-access">
              {accessLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  prefetch={false}
                  aria-current={currentHref === link.href ? "page" : undefined}
                  data-design="app-menu-item"
                  onClick={closeMenu}
                >
                  {t(link.label)}
                </Link>
              ))}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
