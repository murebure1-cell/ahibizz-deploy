import Link from "next/link";
import { Suspense } from "react";
import { Icon, type IconName } from "../../../../components/Icon";
import { AccountPreview } from "../../../../components/preview/AccountPreview";
import { MessagingPreview } from "../../../../components/preview/MessagingPreview";

const sections = {
  poruke: {
    title: "Tvoji razgovori",
    text: "Ovdje će biti poruke s korisnicima i AhiBizz timom.",
    icon: "message",
  },
  nalog: {
    title: "Tvoj AhiBizz",
    text: "Jedno mjesto za tvoje djelatnosti, termine i postavke.",
    icon: "user",
  },
  oglasavanje: {
    title: "Prostor za tvoj posao",
    text: "Ovdje ćeš birati poziciju i trajanje promocije.",
    icon: "shop",
  },
  credits: { title: "Ahi Credits", text: "Krediti za promociju tvoje djelatnosti.", icon: "star" },
} satisfies Record<string, { title: string; text: string; icon: IconName }>;

export default async function PreviewSpace({ params }: { params: Promise<{ section: string }> }) {
  const key = (await params).section;
  if (key === "nalog")
    return (
      <Suspense>
        <AccountPreview />
      </Suspense>
    );
  if (key === "poruke")
    return (
      <Suspense>
        <MessagingPreview />
      </Suspense>
    );
  const section = key in sections ? sections[key as keyof typeof sections] : sections.nalog;
  return (
    <main id="glavni-sadrzaj" className="preview-container preview-space">
      <span className="preview-space-icon">
        <Icon name={section.icon} />
      </span>
      <span className="preview-kicker">SLJEDEĆI KORAK</span>
      <h1>{section.title}</h1>
      <p>{section.text}</p>
      <p className="preview-space-note">Ovaj dio još nije povezan.</p>
      <Link className="preview-button" href="/pregled">
        Na početnu
      </Link>
    </main>
  );
}
