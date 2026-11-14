import { PreviewInstall } from "../../../components/preview/PreviewPwa";
export default function InstallPage() {
  return (
    <main id="glavni-sadrzaj" className="preview-container">
      <PreviewInstall standalone />
      <p className="preview-install-help">
        Na telefonu otvori ovaj link u Chromeu (Android) ili Safariju (iPhone). Instalirana verzija
        prikazuje najnoviji objavljeni pregled kada si povezan na internet.
      </p>
    </main>
  );
}
