import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountDashboard } from "../../../components/account/AccountDashboard";
import {
  accountReturnPath,
  accountSection,
  productionRequestPath,
} from "../../../lib/account-return";
import { campaignPath, readCampaignSelection } from "../../../lib/ad-brief";
import {
  businessInquiryPath,
  ownerCalendarPath,
  readBusinessInquiry,
  readCalendarTarget,
} from "../../../lib/business-today";
import { placementOfferPath, readPlacementTarget } from "../../../lib/marketing";
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
  const params = new URLSearchParams();
  for (const [name, values] of Object.entries(query))
    for (const value of Array.isArray(values) ? values : values === undefined ? [] : [values])
      params.append(name, value);
  const campaign = readCampaignSelection(params);
  const placement = readPlacementTarget(params);
  const calendar = readCalendarTarget(params),
    inquiry = readBusinessInquiry(params);
  if (query.odjeljak === "poruke" && !inquiry) {
    try {
      messageTarget = readMessageTarget(params) ?? undefined;
    } catch {
      invalidMessageTarget = true;
    }
  }
  const requestedPath = params.size ? `/nalog?${params}` : "/nalog";
  const closedPath = accountReturnPath(requestedPath);
  const continuation = invalidMessageTarget
    ? "/nalog"
    : closedPath !== "/nalog"
      ? closedPath
      : accountReturnPath(
          campaign
            ? campaignPath(campaign)
            : placement
              ? placementOfferPath(placement)
              : calendar
                ? ownerCalendarPath(calendar)
                : inquiry
                  ? businessInquiryPath(inquiry)
                  : messageTarget
                    ? messageLink(messageTarget)
                    : query.odjeljak === "oglasi" && query.usluga === "produkcija"
                      ? productionRequestPath
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
      key={profile.id}
      initial={profile}
      messageTarget={messageTarget}
      invalidMessageTarget={invalidMessageTarget}
      initialSection={Object.keys(query).length === 0 ? "overview" : accountSection(query.odjeljak)}
    />
  );
}
