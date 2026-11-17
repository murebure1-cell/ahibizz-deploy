import Image from "next/image";
import Link from "next/link";
import {
  businessLocationLabel,
  type PublicBusinessView,
  safeBusinessImage,
} from "../../lib/public-business";
import { Icon } from "../Icon";
import { BusinessLogo } from "./BusinessLogo";
import styles from "./public-search.module.css";

export function DirectoryResultCard({ business }: { business: PublicBusinessView }) {
  const logo = safeBusinessImage(business.logo);
  const image = safeBusinessImage(business.image);
  const monogram = Array.from(business.title)[0]?.toLocaleUpperCase("bs") || "A";
  return (
    <article className={styles.card}>
      <div className={styles.mark} aria-hidden="true">
        {logo ? (
          <BusinessLogo src={logo.src} alt="" monogram={monogram} />
        ) : image ? (
          <Image
            src={image.src}
            alt=""
            width={72}
            height={72}
            unoptimized
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
          />
        ) : (
          monogram
        )}
      </div>
      <div className={styles.cardBody}>
        {business.categoryName && (
          <p className={styles.category}>
            {[business.categoryName, business.subcategoryName].filter(Boolean).join(" · ")}
          </p>
        )}
        <h2>
          <Link href={`/djelatnosti/${business.id}`}>{business.title}</Link>
          {business.verified && (
            <span className={styles.verified} title="Verifikovana djelatnost">
              <Icon name="check" />
              <span className={styles.srOnly}>Verifikovana djelatnost</span>
            </span>
          )}
        </h2>
        {business.description && <p className={styles.description}>{business.description}</p>}
        <p className={styles.location}>
          <Icon name="pin" />
          {businessLocationLabel(business)}
        </p>
      </div>
    </article>
  );
}
