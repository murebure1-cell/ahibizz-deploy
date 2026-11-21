import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountPreview } from "../../../../components/preview/AccountPreview";
import { MessagingPreview } from "../../../../components/preview/MessagingPreview";

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
  if (key === "oglasavanje") redirect("/oglasavanje");
  notFound();
}
