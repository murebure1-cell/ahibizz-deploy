"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const links = [
  { href: "/", label: "Početna" },
  { href: "/pretraga", label: "Istraži djelatnosti" },
  { href: "/ljudi", label: "Ljudi" },
  { href: "/nalog?odjeljak=poruke", label: "Poruke" },
  { href: "/nalog", label: "Moj nalog" },
  { href: "/o-nama", label: "O AhiBizzu" },
  { href: "/instaliraj", label: "Instaliraj AhiBizz" },
];
const accessLinks = [
  { href: "/prijava", label: "Prijava" },
  { href: "/registracija", label: "Napravi nalog" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const onOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    window.addEventListener("pointerdown", onOutside);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("pointerdown", onOutside);
    };
  }, [open]);

  return (
    <header ref={header} className="site-header">
      <div className="container header-inner">
        <Link
          className="brand"
          href="/"
          aria-label="AhiBizz — početna"
          onClick={() => setOpen(false)}
        >
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
              onClick={() => setOpen(false)}
            >
              {link.label}
              <Icon name="arrow" />
            </Link>
          ))}
          <div className="header-access">
            {accessLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={currentHref === link.href ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}
