import type { PoolClient } from "pg";

// Only use inside an authorized edit transaction. Anonymous reads use the published table.
export const editableImages = `(
  SELECT p.business_id,p.kind,p.slot,p.bytes,p.mime,p.width,p.height,p.version
    FROM directory_business_image_proposal p
   WHERE p.business_id=$1 AND p.bytes IS NOT NULL
   UNION ALL
  SELECT i.business_id,i.kind,i.slot,i.bytes,i.mime,i.width,i.height,i.version
    FROM directory_business_image i
   WHERE i.business_id=$1 AND NOT EXISTS (
     SELECT 1 FROM directory_business_image_proposal p
      WHERE (p.business_id,p.kind,p.slot)=(i.business_id,i.kind,i.slot)
   )
) image`;

export async function clearBusinessImageProposals(client: PoolClient, businessId: string) {
  await client.query("DELETE FROM directory_business_image_proposal WHERE business_id=$1", [
    businessId,
  ]);
}

// Caller holds the business lock and has advanced its version for this approval.
export async function applyBusinessImageProposals(client: PoolClient, businessId: string) {
  await client.query(
    `DELETE FROM directory_business_image i USING directory_business_image_proposal p
      WHERE p.business_id=$1 AND p.bytes IS NULL
        AND (p.business_id,p.kind,p.slot)=(i.business_id,i.kind,i.slot)`,
    [businessId],
  );
  await client.query(
    `INSERT INTO directory_business_image(business_id,kind,slot,bytes,mime,width,height,version)
     SELECT p.business_id,p.kind,p.slot,p.bytes,p.mime,p.width,p.height,b.version
       FROM directory_business_image_proposal p JOIN directory_business b ON b.id=p.business_id
      WHERE p.business_id=$1 AND p.bytes IS NOT NULL
     ON CONFLICT(business_id,kind,slot) DO UPDATE
       SET bytes=EXCLUDED.bytes,mime=EXCLUDED.mime,width=EXCLUDED.width,height=EXCLUDED.height,
           version=EXCLUDED.version,updated_at=now()`,
    [businessId],
  );
  await clearBusinessImageProposals(client, businessId);
}
