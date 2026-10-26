import styles from "./dashboard.module.css";

/**
 * Owner issue #20: photos that live on Instagram or Facebook. FastQue has no authorised connection
 * to either account, so it cannot fetch them; saying so plainly, and giving the manual route that
 * does work, is the whole feature. Nothing here reads, imports or stores social account data.
 */
export function SocialPhotoNote() {
  return (
    <div className={styles.hint} style={{ margin: "0 0 12px" }} data-testid="social-photo-note">
      <strong>Photos from Instagram or Facebook?</strong> FastQue is not connected to your social
      accounts, so it cannot import them for you. Save the photo to your phone or computer from the
      app (or from your own account&apos;s download option), then use Upload above. Only photos you
      own or have permission to use should be added.
    </div>
  );
}
