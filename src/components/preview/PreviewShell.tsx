"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../Icon";

const navigation: { href: string; label: string; icon: IconName }[] = [
  { href: "/pregled", label: "Početna", icon: "home" },
  { href: "/pregled/pretraga", label: "Pretraga", icon: "search" },
  { href: "/pregled/prostor/poruke", label: "Poruke", icon: "message" },
  { href: "/pregled/prostor/nalog", label: "Nalog", icon: "user" },
];

export function PreviewShell() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      <div className="preview-notice">
        Pregled dizajna <span>·</span> Probni sadržaj
      </div>
      <header className="preview-header">
        <div className="preview-container preview-header-inner">
          <Link href="/pregled" aria-label="AhiBizz — početna" onClick={() => setOpen(false)}>
            <Image
              src="/brand/ahi-logo-color.svg"
              alt="AhiBizz"
              width={148}
              height={40}
              unoptimized
            />
          </Link>
          <nav className="preview-desktop-nav" aria-label="Glavni meni">
            {navigation.slice(0, 2).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={path === item.href ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            ref={toggle}
            className="preview-menu"
            type="button"
            aria-label={open ? "Zatvori meni" : "Otvori meni"}
            aria-controls="preview-menu-panel"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
        <nav
          id="preview-menu-panel"
          className="preview-menu-panel"
          aria-label="Dodatni meni"
          hidden={!open}
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={path === item.href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
          <Link href="/o-nama" onClick={() => setOpen(false)}>
            O projektu
          </Link>
          <Link href="/pregled/ljudi" onClick={() => setOpen(false)}>
            <Icon name="user" />
            Ljudi
          </Link>
          <Link href="/pregled/instaliraj" onClick={() => setOpen(false)}>
            Instaliraj AhiBizz
          </Link>
        </nav>
      </header>
      <nav className="preview-bottom-nav" aria-label="Navigacija aplikacije">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={path === item.href ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
