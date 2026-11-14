import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountDashboard } from "../../../components/account/AccountDashboard";
import { accountReturnPath, accountSection } from "../../../lib/account-return";
import { type MessageTarget, messageLink, readMessageTarget } from "../../../lib/messaging";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../server/auth/accounts";
export const dynamic = "force-dynamic";
export const metadata = { title: "Moj nalog" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  let messageTarget: MessageTarget | undefined,
    invalidMessageTarget = false;
  if (query.odjeljak === "poruke") {
    const params = new URLSearchParams();
    for (const [name, values] of Object.entries(query))
      for (const value of Array.isArray(values) ? values : values === undefined ? [] : [values])
        params.append(name, value);
    try {
      messageTarget = readMessageTarget(params) ?? undefined;
    } catch {
      invalidMessageTarget = true;
    }
  }
  const continuation = invalidMessageTarget
    ? "/nalog"
    : accountReturnPath(
        messageTarget
          ? messageLink(messageTarget)
          : typeof query.odjeljak === "string"
            ? `/nalog?odjeljak=${encodeURIComponent(query.odjeljak)}`
            : "/nalog",
      );
  let profile: SafeAccountProfile | undefined;
  try {
    const service = getAccountService();
    if (service) profile = await service.read(await headers());
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status))
      redirect(`/prijava?nastavi=${encodeURIComponent(continuation)}`);
  }
  if (!profile)
    return (
      <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: 70 }}>
        <h1>Nalog trenutno nije dostupan.</h1>
        <p style={{ marginBlock: 18 }}>Pokušaj ponovo kasnije.</p>
        <Link href="/prijava">Na prijavu</Link>
      </main>
    );
  return (
    <AccountDashboard
      initial={profile}
      messageTarget={messageTarget}
      invalidMessageTarget={invalidMessageTarget}
      initialSection={accountSection(query.odjeljak)}
    />
  );
}
